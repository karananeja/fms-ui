# F19 — AI Dashboard Builder · Spec

**Status:** Signed off: 2026-10-15 (user)

| Field | Value |
|---|---|
| Intent | `intent.md` (signed off 2026-10-15) |
| Builds on | F17 assistant (D-105 tool runner + streaming, D-107 fake model), F18 store + contract (D-119…D-121: `applyTurn`, `appendMessage`, `undo`, thread, widget catalogue, `version`), D-116 (fixed catalogue, owner-only AI writes, `dashboards.use`). |
| Serves | F20: the dashboard page docks this chat (hook + store + chips + undo defined here; layout and page UI are F20's). |
| New dependencies | None. |
| Delivery | One agent in the main checkout (no worktrees), branch `feature/part3-f19-f20` (shared with F20, disjoint files), ports **5273/4101**, decisions **D-122…D-126**. Agents don't commit. Browser e2e for the dashboard chat (F19-T10) runs once F20's `/dashboards/$id` page is on the branch. |

## 1. Files (kebab-case)
```
shared/contract/assistant.ts                   + dashboardChatRequestSchema, new ChatEvent variants (§5), limits (§8)
mock-server/assistant/dashboard-tools.ts       7 dashboard tool specs (§3), name resolution, chip labels
mock-server/assistant/dashboard-tools.test.ts  unit tests (F19-T3, T4)
mock-server/assistant/catalogue-prompt.ts      system-prompt section generated from the contract (§4)
mock-server/assistant/dashboard-chat.ts        turn orchestration: lock, transcript from thread, change-set state, save (§2, §6)
mock-server/assistant/assistant-tools.ts       SPECS += dashboard specs (one sorted list); ToolHost += chat mode + turn state
mock-server/assistant/system-prompt.ts         "read-only" paragraph → dashboards paragraph; + CATALOGUE_PROMPT; dashboard context block
mock-server/assistant/assistant-runner.ts      options: maxIterations, prebuilt messages, onFinish (text + chips)
mock-server/assistant/assistant-config.ts      DASHBOARD_CHAT_MAX_ITERATIONS, DASHBOARD_CHAT_TIMEOUT_MS
mock-server/assistant/fake-model.ts            dashboard rules + built-ins (§9)
mock-server/store/dashboards.ts                applyTurn(..., { extend?: changeId }) (§6)
mock-server/routes/assistant-routes.ts         POST /api/dashboards/:id/chat (SSE)
mock-server/routes/dashboard-routes.ts         undo → 409 chat_busy while a turn runs
mock-server/tests/f19-dashboard-chat.test.ts   contract tests (F19-T5…T8)
mock-server/tests/f17-assistant.test.ts        caching snapshot updated (new tools + prompt)
src/features/assistant/chat-stream.ts          generic streamSse(url, body, onEvent, signal) (F17 transport becomes a wrapper)
src/features/assistant/dashboard-chat-store.ts DashboardChatStore (one per dashboard, §7)
src/features/assistant/use-dashboard-chat.ts   useDashboardChat(dashboardId, callbacks)
src/features/assistant/dashboard-events.ts     tiny bus: dashboard created/changed (F20 list + page subscribe)
src/features/assistant/assistant-store.ts      + dashboard_created on assistant messages
src/features/assistant/components/change-chip.tsx        "Added widget: …" chip with Undo / Undone state
src/features/assistant/components/dashboard-link-card.tsx "Open dashboard" card in the global panel
src/features/assistant/components/message-list.tsx       renders change chips + link cards
src/features/assistant/dashboard-chat.test.tsx           component/store tests (F19-T9)
e2e/dashboard-builder.spec.ts                  F19-T10 (fake model)
```

## 2. Chat endpoints and source of truth
- **Dashboard chat (new):** `POST /api/dashboards/:id/chat`, body `dashboardChatRequestSchema = { message: string (trimmed 1..CHAT_MAX_CHARS) }`, response `text/event-stream`, one JSON `ChatEvent` per `data:` line (F17 wire format).
- **The server-side thread is the source of truth** (F18 `dashboard_messages`). The client sends only the new message; the server rebuilds the model transcript from the stored thread. Reload/resume = `GET /api/dashboards/:id/thread` (F18, unchanged).
- **Global Ask FMS** keeps `POST /api/chat` with the client transcript and no server history (F17). It gains the dashboard tools (§3) with a restricted mode.
- **Pre-stream errors** (JSON envelope, before `hijack`, client gets `ChatHttpError`): 401; 403 without `chat.use` **or** `dashboards.use`; 403 `forbidden` for a viewer of a shared dashboard; 404 for anyone else; 422 bad body; **409 `chat_busy`** when a turn is already running on this dashboard (any tab). `not_configured` is sent as the usual SSE `error` and **nothing is appended** to the thread.
- **Turn flow** (`dashboard-chat.ts`):
  1. Take the per-dashboard in-memory lock (released in `finally`).
  2. `appendMessage(user, {role:'user', text})`.
  3. Build messages (below) and run the tool runner (§8 limits).
  4. On any end (done, refusal, error, timeout, client abort), append the assistant message: streamed text (plus a note: "(stopped)", "(error: …)", "(stopped after N steps)"), chips (≤ 50), `changeId` = the turn's latest change set. Emit `thread_saved`, then `done`/`error` (on a client abort the save still happens, nothing is emitted).
- **Transcript built from the thread:**
  - The last ≤ `CHAT_MAX_TURNS` (30) messages, starting at a user message, as text only.
  - Each assistant turn that changed the dashboard gets a line appended: `[Changes: Added widget "Top idle vehicles" (w-1a2b); Renamed dashboard to "Ops today"]`. If that change set was later undone, `[The user undid these changes]` is added too. So the model knows about undo without new message types.
  - Placement: the F17 `<context>` block (user, role, fleets, today) stays the first block of the **first** user turn. A `<dashboard>` block goes before the text of the **latest** user turn only. The block holds the id, title, description, version, the widget types the user may use, and the widgets as compact JSON (`id, type, title, settings`) in lg reading order. Earlier turns stay byte-stable (append-only history), which keeps the messages prefix cacheable.

## 3. Tools (added to the one sorted F17 list; `strict: true` subject to Q4)
The same 15 tool definitions go to both chats, so the cached prefix (tools → system) is shared by every user and both chats. Behaviour depends on the **chat mode** in `ToolHost`: `{kind:'dashboard', dashboardId}` or `{kind:'global'}`. Every dashboard tool checks:
- `dashboards.use`, else "Not permitted";
- owner-only through the store (`requireOwned`): another user's dashboard and dashboards shared *with* the caller are both reported as "not found among your dashboards".

| Tool | Input (zod) | Global chat | Dashboard chat | Result to model | Chip label |
|---|---|---|---|---|---|
| `create_dashboard` | `{ title: titleSchema, description?: ≤500, widgets?: widgetToolInput[] ≤ 24 }` | ✔ | ✔ (creates a *separate* dashboard) | `{dashboardId, url:'/dashboards/<id>', version, widgets:[{id,type,title}]}` | `Created dashboard "Ops today" (3 widgets)` |
| `get_dashboard` | `{ dashboard?: string }` (id or exact/contains title among *owned*; default = current in dashboard chat) | ✔ | ✔ | `{id,title,description,version,widgets (full settings), order (lg reading order)}`, or `matches[]` if ambiguous | `Reading dashboard…` |
| `add_widget` | `{ widget: widgetToolInput }` | ✘ | ✔ | `{widgetId, version}` | `Added widget: <title>` |
| `update_widget` | `{ widgetId, widget: widgetToolInput }` (full replacement; type may change; same id and layout slot) | ✘ | ✔ | `{widgetId, version}` | `Updated widget: <title>` |
| `remove_widget` | `{ widgetIds: widgetId[1..24] }` | ✘ | ✔ | `{removed[], version}` | `Removed widget: <title>` (or `Removed 3 widgets`) |
| `arrange_widgets` | `{ order: widgetId[1..24], sizes?: [{widgetId, w: 1..12, h: 1..24}] ≤ 24 }` | ✘ | ✔ | `{version}` | `Rearranged widgets` |
| `rename_dashboard` | `{ title?: titleSchema, description?: ≤500 }` (≥ 1 field) | ✘ | ✔ | `{title, version}` | `Renamed dashboard to "<title>"` |

- **`widgetToolInput`** = F18 `widgetInputSchema` with no `id`, and with friendlier reference fields: `fleetId`/`fleetIds` accept a fleet **name or id**, `vehicleId` a **regno or id**, `driverId` a **driver name or id**. These are resolved in the user's scope with the F17 helpers (`resolveFleet`, `resolveVehicle`, driver lookup) and stored as canonical ids. Out of scope or unknown → "… was not found among the data you can access". The stored widget is then validated by the F18 store, so nothing outside the catalogue can be saved (D-116).
- **Mode rules:**
  - In the **global** chat, the mutating tools return "Changes are made in the dashboard's own chat. Offer the user the link /dashboards/<id>". The model is told to put every widget in one `create_dashboard` call.
  - In a **dashboard** chat, mutating tools act only on the current dashboard; there is no `dashboardId` input, so the model can't target another one.
- **`arrange_widgets`:**
  - `order` must list existing ids. Missing ids keep their relative order after the listed ones; unknown ids → error.
  - The server rebuilds lg by packing rows in that order with the current (or given) `w×h`, clamped to `WIDGET_SIZES` minimums and 12 cols, then rebuilds md (6 cols, `w = min(w, 6)`) and sm (1 col) in the same order.
- **Errors → `is_error` tool results** (never thrown to the user):
  - zod failures list paths ("widget.range: expected one of 7d, 30d, 90d");
  - 422 `widget_not_permitted` → "Not permitted: your role can't see <type> data (<permission>)";
  - 24-widget limit → "This dashboard already has 24 widgets (the maximum)";
  - 409 `dashboard_limit` → "You already own 50 dashboards";
  - unknown widget id → not found.
  - The chip gets `status: 'error'` with the short summary.
- **Read tools** (F17's 8) are unchanged and available in both chats. The prompt tells the model to use them to check fleets, vehicles and drivers before building.

## 4. How the model learns the catalogue
- `catalogue-prompt.ts` exports `CATALOGUE_PROMPT`, generated **at module load from the contract**: `WIDGET_TYPES`, each type's fields and enum values (`KPI_METRICS`, `KPI_FIELDS`, `TIME_RANGES`, `VEHICLE_STATUSES`, `VEHICLE_LIST_COLUMNS`, `DRIVER_STATUSES`, `REQUEST_TYPES`), limits (`WIDGETS_PER_DASHBOARD`, `LIST_LIMIT_MAX`, `WIDGET_TITLE_MAX`, `TEXT_NOTE_MAX`), `WIDGET_PERMISSIONS`, `WIDGET_SIZES`, plus one example input per type and one-line "use it for" hints (e.g. "ranking: top/bottom N vehicles or drivers by a KPI"). Output is deterministic (sorted, no ids, no dates). It is appended to the frozen `SYSTEM_PROMPT`, so a contract change updates the prompt automatically and the snapshot test (F19-T2) flags it.
- `SYSTEM_PROMPT` edits:
  - "You are read-only…" becomes "You can create and change **only the signed-in user's own dashboards**, using the dashboard tools. Everything else is read-only (no driver assignment, request handling or settings)."
  - New "Dashboards" section:
    - check names with the read tools first;
    - prefer one call that does several things (`create_dashboard` with all widgets);
    - use the widget types listed as permitted in `<dashboard>` / `<context>`;
    - keep titles ≤ 60 chars;
    - after changes, say briefly what changed (the app shows chips and an Undo);
    - in the global chat, end by offering the link `/dashboards/<id>`;
    - never write code or HTML; only catalogue widgets exist.
- **Per-user permitted widget types** (from `widgetPermission` × the user's permissions) are added to `<context>` (both chats). This is user-specific, so it sits in the first user turn, not the system prompt.

## 5. SSE events (added to `chatEventSchema`; existing events unchanged)
```ts
{ type: 'dashboard_changed', dashboardId, changeId, version, label /* chip text */, summary /* turn summary so far */,
  dashboard: Dashboard }                       // after every successful mutating tool call
{ type: 'dashboard_created', dashboard: DashboardSummary, url: string }   // create_dashboard (both chats)
{ type: 'thread_saved', messages: ThreadMessage[] }   // dashboard chat only: the stored user + assistant messages
```
- Order within a turn: `tool_start` → (`dashboard_changed` | `dashboard_created`)? → `tool_end` → … `text` … → `thread_saved` → `done` | `error`.
- `dashboard` carries the full new state (≤ 24 widgets), so F20 replaces its copy and version without refetching. The page shows changes "straight away" (per tool call, not at the end of the turn).
- `ChatEvent` stays one discriminated union. F17's `SseParser` skips unknown events, so older clients aren't affected.

## 6. Change sets, versions and undo inside a turn
- **One change set per turn** (D-121 "undo one step per turn"), extended per tool call, as a store addition:
  `applyTurn(ownerId, id, expectedVersion, summary, mutate, opts?: { extend?: changeId })`.
  - With `extend`, the store **updates** that change set (`after_version`, `summary`) and keeps its `before` snapshot. This only happens if it is still the dashboard's latest change set, not undone, and `row.version === after_version`.
  - Otherwise it inserts a new change set (the earlier one is then `not_undoable` anyway).
- **Versions:** AI edits are semantic (by widget id) and run inside one SQLite transaction, so the tool reads the **current** version as `expectedVersion`. The model never sees a 409.
  - If the user edits the page mid-turn (an F20 layout drag → PATCH v+1), the next tool call starts a new change set based on that version. The manual edit is never folded into, or reverted by, the AI's undo.
  - A widget removed manually mid-turn → `update_widget` "not found", and the model explains.
- **Summary** = labels joined with "; " (≤ 500 chars, store cap). The assistant message's `changeId` = the turn's latest change set.
- **Undo** = existing F18 `POST /api/dashboards/:id/changes/:changeId/undo {version}` → 200 `dashboard` v+1.
  - New: 409 `chat_busy` while a turn runs on that dashboard.
  - Existing errors: 409 `not_undoable` (not latest / already undone / edited since), 409 `version_conflict`.
  - Undo isn't written to the thread as a message. The next transcript carries `[The user undid these changes]` (§2), and the thread's `change.undoneAt` drives the chip's "Undone" state.
- **Global create:** `create_dashboard` uses F18 `create` (v1, no change set; "undo" = delete). It also **seeds the new dashboard's thread** with the user's prompt and an assistant message (the final answer text and the create chip; Q2), so opening the link shows how the dashboard was built and the chat continues there.

## 7. Client pieces for F20 (no page layout here)
- `streamSse(url, body, onEvent, signal)` in `chat-stream.ts` (F17 `httpChatTransport` becomes `streamSse('/api/chat', …)`). Same validation, `ChatHttpError` for pre-stream statuses (adds `chat_busy` → "Another reply is in progress on this dashboard").
- `DashboardChatStore` (main thread, class + `useSyncExternalStore`, F17-R6 style), one instance per dashboard id, disposed on unmount or user change:
  - **state** `{ status: 'loading'|'ready'|'error', messages: DashboardChatMessage[], streaming, notConfigured, error }`, where `DashboardChatMessage` = a `ThreadMessage` view (+ live `tools`, `status: 'streaming'|'done'|'stopped'|'error'`).
  - **`load()`**: `GET …/thread`. **`send(text)`**: optimistic user message, then stream. **`stop()`**: aborts (the server still saves). **`retry()`**: sends the last user text again as a new turn.
  - **`undo(changeId, version)`**: calls REST. On 200 it marks the chip undone and calls `onDashboardChanged(dashboard)`; on 409 it shows "This change can no longer be undone" and reloads the thread.
  - **`thread_saved`** replaces the optimistic pair with the stored messages (ids, `seq`, `change.undoable`). After a later turn or undo, earlier chips lose Undo, because `undoable` is recomputed from the reloaded thread.
- `useDashboardChat(dashboardId, { onDashboardChanged(dashboard, event?), onDashboardCreated(summary, url) })` → `{ state, send, stop, retry, undo }`. F20 passes `onDashboardChanged` to replace its dashboard state and rebase pending layout saves onto `dashboard.version`.
- `dashboard-events.ts`: `dashboardEvents.emit({kind:'created'|'changed', dashboardId})`. The global store and the dashboard chat both publish; F20's list page subscribes to refetch.
- **Components** (F20 places them):
  - `ChangeChip`: label, ok/error icon, **Undo** button shown only on the turn's change when `change.undoable` and nothing is streaming; "Undone" badge when `undoneAt`; `data-testid="change-chip"`.
  - `DashboardLinkCard`: "Open dashboard" → `/dashboards/$id`; `data-testid="dashboard-link"`.
  - `MessageList` / `Composer` (F17) are reused unchanged apart from rendering these.
- **Global panel:** on `dashboard_created`, the assistant message gets `dashboards: [{summary, url}]` and shows a `DashboardLinkCard`. The F17 transcript and limits are otherwise unchanged.

## 8. Limits
| Item | Value |
|---|---|
| Tool-runner steps per turn | dashboard chat **12** (`DASHBOARD_CHAT_MAX_ITERATIONS`); global chat stays 8 |
| Turn timeout | dashboard chat **90 s**; global 60 s |
| Mutating tool calls per turn | 30 (then "Too many changes in one turn; continue in a new message") |
| Widgets | 24 per dashboard, 50 owned dashboards (F18) |
| Message | 1..4000 chars; transcript ≤ 30 messages; thread ≤ 200 (F18) |
| Concurrency | 1 running turn per dashboard (409 `chat_busy`) |
| `max_tokens`, model, effort, fallbacks, caching | as D-105 |

## 9. Fake model (D-107 conventions)
- The dashboard rules match only when the latest user turn contains a `<dashboard>` block (dashboard chat) or the word "dashboard" (global). They are checked **before** the F17 rules. The fake parses the `<dashboard>` JSON block to pick widget ids, so every script is a single deterministic tool step followed by a text answer built from the results.

| Trigger | Script |
|---|---|
| global: build/create/make … dashboard | `create_dashboard {title:"Fleet overview", widgets:[kpi live running, status-breakdown donut, ranking vehicles idleMs desc 10 7d]}` → "I created **Fleet overview** … [Open it](/dashboards/<id>)" |
| dashboard: build/add … (no widgets yet) | parallel `add_widget` ×3 (same 3 widgets) |
| dashboard: add … note/text | `add_widget {type:'text'}` |
| dashboard: change/update/make … 30 days | `update_widget` on the first `ranking` (range `30d`) |
| dashboard: remove/delete … | `remove_widget` on the widget whose title matches a word in the question, else the last |
| dashboard: rename … to "X" | `rename_dashboard {title:X}` |
| dashboard: arrange/reorder | `arrange_widgets` in reverse order |
| `[fake:dash-invalid]` | `add_widget {type:'iframe'}` → tool error → apologetic text |
| `[fake:dash-many]` | 13 tool steps (exercises the 12-step cap) |

- `POST /api/dev/assistant/script` (explicit steps) still works for one-off tests; `GET /api/dev/assistant/last-request` is used to assert transcript shape.

## 10. Acceptance tests
| ID | Type | Test |
|---|---|---|
| F19-T1 | unit (contract) | New `ChatEvent` variants and `dashboardChatRequestSchema` parse/reject; `widgetToolInput` accepts all 8 types and rejects `iframe`, extra `html`, `id`. |
| F19-T2 | unit (caching) | `CATALOGUE_PROMPT` names every `WIDGET_TYPES` member and enum value; system prompt + 15 tool definitions are byte-identical across users, requests and **both chat modes** (snapshot); no ids/dates in the prefix; `<dashboard>` appears only in the latest user turn. |
| F19-T3 | unit (tools) | On a `:memory:` store as `ops`: create with 3 widgets (ids returned), get (by id and by title), add, update (range change, type change), remove, arrange (lg order + md/sm rebuilt), rename; fleet name → id; out-of-scope fleet/vehicle → not found; `driver-list` for Operator → "Not permitted"; 25th widget → limit message; 4 mutations in one turn → **one** change set; a PATCH between two calls → two change sets, and undo of the latest doesn't revert the PATCH. |
| F19-T4 | unit (scope) | **Intent "scope test":** as `ops`, `get_dashboard`/mutations on superadmin's dashboard id → not found; on a dashboard superadmin shared **with** ops → not found; nothing changes (versions unchanged). Global-mode mutation → "open the dashboard" error. |
| F19-T5 | contract | `POST /api/dashboards/:id/chat` (fake): event order (§5), `dashboard_changed` versions increase, `thread_saved` = 2 messages, `GET …/thread` shows chips + undoable change; REST undo → previous content v+1; concurrent second turn → 409 `chat_busy`; undo during a turn → 409 `chat_busy`. Viewer → 403, stranger → 404, `viewer@fms.local` (no `dashboards.use`) → 403, signed out → 401. |
| F19-T6 | contract (resume) | Second turn: `last-request` contains the first turn's text, the `[Changes: …]` line, and after an undo the `[The user undid these changes]` line; `<context>` in the first user turn only. |
| F19-T7 | contract (errors) | refusal / busy (`[fake:busy]`) / timeout / client abort mid-turn: changes made so far stay and are undoable; the assistant message is saved with its note; the `[fake:dash-many]` cap → "stopped after 12 steps"; `not_configured` → nothing appended. |
| F19-T8 | contract (global) | `/api/chat` "Build a dashboard of running vs stopped and top idle vehicles" → `dashboard_created` with `url`, dashboard has ≥ 3 widgets, its thread is seeded with 2 messages. |
| F19-T9 | component | `DashboardChatStore`: load, send, folds events, calls `onDashboardChanged`, `thread_saved` reconciliation, Undo (200 / 409), Stop, `chat_busy` text; global panel renders `DashboardLinkCard`. |
| F19-T10 | e2e (fake, with F20 page) | **Intent "done when":** global prompt → link → page shows ≥ 3 widgets; "make the ranking 30 days" → chip + widget updates; remove one; rename (title bar updates); Undo on the last chip restores it; reload → thread and chips are back (Undone shown). |
| F19-T11 | manual | Real-key smoke: the same flow with `ANTHROPIC_API_KEY`; usage/cache-read logged in the test report. |
| F19-T12 | cmd | Targeted vitest while iterating; at the end `pnpm check`, `pnpm build` (no `@anthropic-ai/sdk`/`node:sqlite` in `dist/`), e2e setup + chromium on 5273/4101. |

## 11. Decisions to propose
- **D-122:** Dashboard chat = `POST /api/dashboards/:id/chat` (SSE, `chat.use` + `dashboards.use`, owner only). The stored thread is the source of truth; the server rebuilds a ≤ 30-message text transcript with change/undo notes; `<dashboard>` snapshot in the latest user turn only. The global chat keeps the client transcript.
- **D-123:** Seven dashboard tools join the F17 list as one fixed, sorted set for both chats (cache-stable). Owner-only (shared and others' = not found). Dashboard chat mutates only its own dashboard; global chat may only create and read. Reference fields accept names (resolved in scope). The catalogue section of the system prompt is generated from the contract.
- **D-124:** One change set per turn, extended per tool call (`applyTurn` `extend`). AI edits rebase on the current version (no 409 to the model); a manual edit mid-turn starts a new change set. One running turn per dashboard (409 `chat_busy`, also blocks undo).
- **D-125:** New SSE events `dashboard_changed` (full dashboard + chip label), `dashboard_created` (summary + url), `thread_saved`. Dashboard chat limits: 12 steps, 90 s, 30 mutations per turn. A new dashboard created from the global chat gets its thread seeded with the creating turn.
- **D-126:** Fake-model dashboard rules (deterministic, read widget ids from the `<dashboard>` block) and built-ins `dash-invalid`, `dash-many`.

## 12. Risks
- **Strict tool schemas:** the widget union (8 types, nested union on `kpi.source`/`ranking.entity`, many optional fields) may exceed what strict mode accepts, or have its min/max constraints dropped. Zod still validates every input, so the fallback is `strict: false` on the 4 widget-carrying tools (Q4). Verify in F19-T11 and with a fake-mode test that the definitions serialise.
- **One-time cache change:** the F17 prefix changes (new tools and prompt) and the F17 snapshot test is updated. The prompt also grows (catalogue ≈ 1.5–2.5 k tokens), which is cached.
- **Races with F20 drags:** F20 must take the version from `dashboard_changed` events, or its next debounced PATCH gets 409 (F20 then reloads with a notice).
- **Model quality:** wrong metric choice or too many widgets. Mitigated by the catalogue hints, permitted types in context, the 24-widget cap and one-step undo. The real-key smoke test is the only check.
- **In-memory lock:** the per-dashboard lock is lost on restart (harmless; turns die with the server). Multiple server processes aren't supported (mock).
- **Fake rules are keyword-based:** e2e prompts must use the documented trigger words.

## 13. Resolved questions (user, 2026-10-15)
1. The global chat can't edit existing dashboards: it only creates and reads, and offers the link.
2. The turn that created a dashboard is copied into that dashboard's thread.
3. `update_widget` replaces the whole widget.
4. `strict: true` stays on if the API accepts the schema; otherwise only the 4 tools that carry widgets use `strict: false` (zod still validates).
5. Dashboard-chat limits: 12 steps / 90 s / 30 changes per turn. The global chat stays at 8 steps / 60 s.
6. Read-only tool chips are saved in the thread too; only chips for tools that change the dashboard get the change style.

## 14. Out of scope
Widgets outside the catalogue, AI-written code/HTML, chat on dashboards shared with you, multi-step undo/history, scheduled e-mails, dashboard page layout/UI (F20), moving the global chat to server-side history.
