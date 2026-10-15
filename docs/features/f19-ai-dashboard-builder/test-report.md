# F19 — Test report

Branch `feature/part3-f19-f20` (main checkout, shared with F20, disjoint files). Ports 5273/4101. Fake model (`FMS_ASSISTANT_FAKE=1`) for every automated test.

## Runs (2026-10-15)
| Command | Result |
|---|---|
| `pnpm vitest run mock-server/assistant mock-server/tests/f17-assistant.test.ts mock-server/tests/f18-dashboards.test.ts mock-server/tests/f19-dashboard-chat.test.ts src/features/assistant shared/contract` | **78/78** (8 files) |
| `tsc -b` on F19 files | clean (remaining errors are F20's in-progress `router.tsx` / `no-access-page.tsx`) |
| `eslint` on F19 files | clean |
| `pnpm build`, full `pnpm check` | not run by F19 (F20's page modules were not on the branch yet); orchestrator runs them once at the end |

## Acceptance tests
| ID | Result | Where / notes |
|---|---|---|
| F19-T1 | pass | `mock-server/assistant/dashboard-tools.test.ts`: `widgetToolInput` takes all 8 types, rejects `iframe` / extra `html` / `id`; request schema and new events parse/reject |
| F19-T2 | pass | same file: catalogue names every type and enum value; 15 definitions + system prompt byte-identical across users and both chat modes; no dates/ids/names; strict-safe schemas; `<dashboard>` only in the latest user turn, `<context>` in the first |
| F19-T3 | pass | create (3 widgets, fleet name → id), get by id/title, add, update (range, type change keeps slot and grows to the new minimum), remove, arrange (lg order + md/sm rebuilt, size clamped), rename; 6 mutations → one change set; out-of-scope fleet/vehicle → not found; Operator `driver-list` → not permitted; 25th widget → limit message; PATCH between calls → two change sets and undo keeps the PATCH |
| F19-T4 | pass | ops on superadmin's own and shared-with-ops dashboards: get/rename/add/remove → "not found among your dashboards", versions unchanged; global-mode mutation → "dashboard's own chat … /dashboards/<id>"; viewer → not permitted |
| F19-T5 | pass | `mock-server/tests/f19-dashboard-chat.test.ts`: event order, versions 2→3→4 in one change set, `thread_saved` = 2 messages with chips, thread undoable, REST undo → v5; 409 `chat_busy` for a second turn and for undo during a turn; 401 / 403 (viewer role) / 403 forbidden (shared viewer) / 404 / 422 |
| F19-T6 | pass | `last-request`: first turn text + `<context>`, `[Changes: Added widget "…" (w-…); …]`, `<dashboard>` only in the latest turn; after undo `[The user undid these changes]` |
| F19-T7 | pass (timeout by code path) | client abort → change kept + undoable, answer saved with "(stopped)"; refusal / busy → "(error: …)" saved, changes kept; `dash-many` → 12 tool steps, "stopped after 12 steps"; `dash-invalid` → error chip, apologetic text, version unchanged; `not_configured` → nothing appended. The 90 s timeout shares the error path (not waited for in tests) |
| F19-T8 | pass | `/api/chat` "Build a dashboard of running vs stopped and top idle vehicles" → `dashboard_created` (url, 3 widgets), answer links `/dashboards/<id>`, thread seeded with user + assistant (create chip) |
| F19-T9 | pass | `src/features/assistant/dashboard-chat.test.tsx`: load, send, event folding, `onDashboardChanged`, `dashboardEvents`, `thread_saved` reconciliation (earlier Undo dropped), Undo 200 / 409 (notice + reload), Stop (abort + reload), `chat_busy` text, `not_configured`; `useDashboardChat` + `MessageList` chips (Undo on the latest change only, Undone badge, error chip); global panel `DashboardLinkCard` |
| F19-T10 | **pending** | `e2e/dashboard-builder.spec.ts` written (global prompt → link → 3 grid items; "make the ranking 30 days"; remove; rename; Undo; reload). Needs F20's `/dashboards/$id` page with the dock; run with `VITE_PORT=5273 MOCK_PORT=4101 pnpm playwright test --project=setup --project=chromium e2e/dashboard-builder.spec.ts` |
| F19-T11 | pending (manual) | real-key smoke: same flow with `ANTHROPIC_API_KEY`; check `assistant run` logs for `cacheReadInputTokens > 0` from the second request and that the API accepts the strict schemas of the 7 dashboard tools (Q4 fallback: drop `strict` on the widget-carrying tools) |
| F19-T12 | partial | targeted vitest while iterating; full check/build/e2e left to the orchestrator's single end run |

## Addendum: widget previews in chat (D-135), server side, 2026-10-15
`pnpm vitest run mock-server shared`: **506/506** (33 files). `tsc -b` clean for `mock-server/` + `shared/`; eslint + prettier clean on the server files.

| ID | Result | Where / notes |
|---|---|---|
| P-T1 | pass | `mock-server/tests/f19-previews.test.ts`: `preview_widget` returns `{ previewId, widget }` (fresh `w-…` id, fleet name resolved), emits `widget_preview` (size = `WIDGET_SIZES` default), records a chip and `turn.previews`; no `dashboard_changed`, version/widgets unchanged. `iframe` → `Invalid input: widget…`, missing field → path `widget.status`, Operator `driver-list` → not permitted. Global chat: `dashboardId` null or own dashboard; another user's → not found; viewer (no `dashboards.use`) → not permitted. System prompt has the single-widget → `preview_widget` guidance |
| P-T2 | pass | the fake dashboard chat stores the preview on the assistant message (`thread_saved` + `GET …/thread`); `PATCH …/previews/:id` sets `added` / `discarded` (dashboard version unchanged); 422 bad body, 404 unknown preview / unknown dashboard / stranger, 403 viewer role and shared viewer (`forbidden`), 409 `chat_busy` during a turn; next transcript carries `[Previewed widget (not on the dashboard): …]`. Migration 2 on a v1 file: rows intact, `previews_json = '[]'`, CHECK `json_valid` enforced |
| P-T3 | pass | rules: "add a small KPI of running vehicles" → `preview_widget` (both chats), "add a stopped vehicles widget" → `preview_widget`, `[fake:preview]` → `preview_widget`; "build me a fleet health dashboard" → 3× `add_widget` (dashboard chat) / `create_dashboard` (global); "add a note" still `add_widget`. Same events through the Anthropic and OpenAI (F21) paths |

Intentional updates: tool count 15 → 16 (`dashboard-tools.test.ts`, `f17-assistant.test.ts`, `f21-providers.test.ts` + regenerated OpenAI tools snapshot, additive), `database.test.ts` schema version v1 → v2.

## Addendum: auto-title for new dashboards, server side, 2026-10-15
While a dashboard still has the default title ("Untitled dashboard") and no earlier chat turn renamed it, the latest turn's `<dashboard>` block carries `titleIsDefault` + a rename hint (system prompt and tools untouched, F24 prefix snapshot unchanged). If a successful turn ends with the title still default, the server renames it from the first user message (`titleFromPrompt`, `mock-server/assistant/auto-title.ts`) inside the turn's change set (chip "Renamed dashboard: <title>", `dashboard_changed`). The fake model adds `rename_dashboard` to its add/build rules while the hint is present.

| ID | Result | Where / notes |
|---|---|---|
| AT-T1 | pass | `mock-server/tests/f19-auto-title.test.ts`: `titleFromPrompt` cases (filler stripped, Title Case, acronyms, ≤ 40 chars, empty → "Fleet Dashboard") |
| AT-T2 | pass | model path, Anthropic and OpenAI fake wires: build turn calls `rename_dashboard`, 4 changes in one change set, hint only in the user turn (not the system prompt); Undo restores the default title and empty grid |
| AT-T3 | pass | fallback: plain-text turn → renamed "No-GPS Vehicles by Fleet" before `thread_saved`, chip + undoable change on the message; with a widget change the rename extends the same change set; Undo restores the default; later turns neither hint nor rename; error turn → no rename |
| AT-T4 | pass | user-chosen titles (at creation or via PATCH) are never touched; no hint in the block |
| AT-T5 | pass | regression: `f19-dashboard-chat`, `f19-previews`, `f17-assistant`, `f21-providers`, `f24-prompt-caching` (snapshot unchanged), `mock-server/assistant/*` — 115/115; `tsc -b`, eslint, prettier clean |

Client: no change needed. `dashboard_changed` → `onDashboardChanged` → `DashboardSession.adoptRemote`, which takes the whole server dashboard (title included).
