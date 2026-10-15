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
