# F19 — AI Dashboard Builder · Conversation log

## 2026-10-15 — implementation (F19 agent, parallel with F20)
**User (via orchestrator):** "Implement F19 per the signed-off spec (§13 overrides), branch `feature/part3-f19-f20`, no worktrees/commits, ports 5273/4101; expose the §7 client API early for F20."

**Assistant:**
- Client seam first (for F20): `streamSse` in `chat-stream.ts`, `DashboardChatStore`, `useDashboardChat`, `dashboardEvents`, `ChangeChip`, `DashboardLinkCard`; `MessageList` renders stored chips/changes/link cards and takes optional `onUndo` / `undoDisabled` / `undoing`; `Composer` gains optional `placeholder` / `autoFocus`.
- Contract (`shared/contract/assistant.ts`): `dashboardChatRequestSchema`, `widgetToolInputSchema` (F18 catalogue without `id`), events `dashboard_changed` / `dashboard_created` / `thread_saved`, `chat_busy` error code, `DASHBOARD_CHAT_MAX_MUTATIONS` (30), `CHAT_CHIPS_MAX` (50), `DASHBOARD_MUTATING_TOOLS`.
- Server: 7 dashboard tools (`dashboard-tools.ts`) in the one sorted list (15 tools); shared tool plumbing moved to `tool-kit.ts` (avoids an import cycle); `catalogue-prompt.ts` generated from the contract and appended to `SYSTEM_PROMPT`; per-user permitted widget types in `<context>`; `<dashboard>` block in the latest user turn only; `dashboard-chat.ts` (lock, transcript from the thread with `[Changes: …]` / `[The user undid these changes]`, save on every end); `applyTurn(..., { extend })`; `POST /api/dashboards/:id/chat`; undo → 409 `chat_busy` during a turn; global `create_dashboard` seeds the new dashboard's thread (Q2).
- Fake model: dashboard rules (global build/create/make … dashboard; dashboard rename / remove / arrange / "30 days" / add note / build) and built-ins `dash-invalid`, `dash-many`; rules now ignore the `<context>` / `<dashboard>` blocks.
- Strict tools (Q4): the dashboard tools keep `strict: true` but send a strict-safe JSON schema (no numeric/length bounds, `pattern`, `maxItems`; `oneOf` → `anyOf`); zod validates inside `run`, so bad input becomes a chip + `is_error` result with paths.

**Status/Next:** server + client + unit/contract tests green. F19-T10 e2e written; it needs F20's `/dashboards/$id` page (dock with `MessageList` + `Composer`) to run. F19-T11 (real key) pending.
