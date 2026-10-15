# F27 — Test report

**Date:** 2026-10-16 · Branch `feature/f22-persist-admin-data` (uncommitted, shared checkout) · Ports VITE 5373 / MOCK 4201.

| ID | Test | Result |
|---|---|---|
| F27-T1 | Migration v10 on a v9 file: shares → `view`, threads/change sets → owner, `updated_by` backfilled, CHECK on access | Pass |
| F27-T2 | Access matrix owner / editor / viewer / stranger over every dashboard endpoint (+ chat, duplicate, delete) | Pass |
| F27-T3 | Level change applies at once; downgrade and revoke delete that person's thread; unknown share → 404 | Pass |
| F27-T4 | Editor can't share / change access / revoke / delete; `widget_not_permitted` for a driver-list (editor lacks `drivers.manage`) | Pass |
| F27-T5 | Two saves on the same version → one 409, retry keeps both edits; `lastEdit` + activity name who | Pass |
| F27-T6 | Private threads; undo only by the actor; editor's AI turn (tools) runs as the editor; `chat_busy` names the holder | Pass |
| F27-T7 | WS topic `dashboard`: subscribe rules, `changed`, `access` (only to that user; `null` ends it), `deleted`, `assistant` incl. late subscriber | Pass |
| F27-T8 | e2e: editor drags → owner sees "Edited by …" + activity live; editor asks the AI → previews → Add → owner sees the widget live; owner's thread stays empty | Pass |
| F27-T9 | e2e: viewer read-only (static grid, no chat/share/rename); owner downgrades editor in the share dialog → editor's UI turns read-only live, PATCH 403 | Pass |
| F27-T10 | e2e: "Can edit" / "View only" badges in Shared with me | Pass |

Also: `src/features/dashboards/store/dashboard-socket.test.ts` (routing, reconnect `sync`, close when idle); `dashboard-chat.test.tsx` updated for the `chat_busy` notice (D-154).

## Runs
- `pnpm vitest run mock-server`: 250/251 — only the known time-of-day flake F11-T3 (`store/requests.test.ts`). The F21-T2 tool-schema snapshot was refreshed for F26's `custom` widget (schema-only diff).
- `pnpm vitest run src/features/dashboards src/features/assistant src/features/notifications`: 88/88.
- `pnpm exec tsc -b`: clean. ESLint clean on all touched files.
- e2e (`--workers=1`): `f27-edit-sharing` 3/3, `dashboards` 4/4, `f26-dynamic-widgets` 3/3, `dashboard-builder` 1/1.
- Seen once each and green on re-run (shared checkout with another agent): F20-T12 (super-admin auth file overwritten by a parallel setup run), P-T6, F23-T9.
