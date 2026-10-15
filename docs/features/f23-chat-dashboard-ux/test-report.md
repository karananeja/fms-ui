# F23 — Chat & Dashboard UX Polish · Test report

**Date:** 2026-10-16 · **Branch:** `feature/f22-persist-admin-data` (shared checkout, F22/F24 in parallel) · **Ports:** 5373 / 4201

## Results

| Check | Result |
|---|---|
| `tsc -p tsconfig.app.json` (src) | clean |
| `tsc -b` | fails only in `e2e/sheet-scroll.spec.ts` (another agent's in-progress file, DOM types in `evaluate`); F23 files clean |
| eslint `src/features/assistant`, `src/features/dashboards`, `src/app`, `e2e/f23-*.spec.ts` | 0 errors; 8 pre-existing `only-export-components` warnings |
| vitest `src/features/assistant`, `src/features/dashboards`, `src/app` | 78/78 (new `chat-ux.test.tsx`: 13) |
| e2e `f23-chat-dashboard-ux.spec.ts` | 8/8 (F23-T5…T12) |
| e2e `assistant`, `dashboards`, `dashboard-builder`, `dashboard-previews` | all green with `--workers=1` (see notes) |
| `vite build` | clean (via `vite build`; `pnpm build` stops at the `tsc -b` error above) |

## Acceptance tests

F23-T1…T4, T13, T14: vitest (`src/features/assistant/chat-ux.test.tsx`; the old F17 "cut off" test now asserts Interrupted). F23-T5…T12: e2e (`e2e/f23-chat-dashboard-ux.spec.ts`), stream cuts simulated with `page.route` fulfilling a truncated SSE body (`: ping` + one text event, no `done`).

## Scroll bug (R15)

F23-T11 measures the page, `main`, the grid scroller and the dock list at 1440×900 (dock open and collapsed), 1280×720 and 390×844 with an 18-widget dashboard and a 40-message thread: the grid area is the only scroller, the last widget is reached with the wheel, the dock list scrolls on its own with the composer in view. The layout already held after F23's changes; the missing piece was **drag/resize near the scroller edge**, which now auto-scrolls the grid area (`useEdgeAutoScroll` in `dashboard-grid.tsx`). The new empty state scrolls inside the same grid area.

## Bundle (gzip, vs the F20/D-135 report)

| Chunk | Before | After | Δ |
|---|---|---|---|
| `dashboards-page` | 5.4 kB | 8.3 kB | +2.9 (search/sort/view, hero, richer cards, peek) |
| `dashboard-page` | 30.2 kB | 34.1 kB | +3.9 (starter, build skeletons, edge auto-scroll, back link) |
| `widget-preview-card` (shared chat chunk: composer, message list) | 8.6 kB | 12.0 kB | +3.4 (type-ahead + templates, progress row, interrupted) |
| `assistant-panel` | 6.0 kB | 6.1 kB | +0.1 |
| new `widget-meta` (icons/source helpers) | — | 1.9 kB | +1.9 |
| `app-entry` | 102.8 kB | 103.3 kB | +0.5 (includes F21 changes since that report) |

react-grid-layout stays in `dashboard-page` only.

## Notes

- `assistant.spec` F17-T6 fails with 2 workers: the CSV/PDF test posts a one-shot script to `/api/dev/assistant/script` and the parallel driver test's chat request consumes it (server-global script). Pre-existing race, unrelated to F23; passes with `--workers=1`.
- Some parallel runs hit 401 on the first request after `setup` (the shared mock server lost sessions while F22/F24 work was going on); re-runs are green.
- Type-ahead entity completion uses the live-tracking worker (`suggest`) and its fleet list; with no `live.view` (or before the worker starts) only prompt templates are offered.

## Bug fix 2026-10-16: Retry lost after leaving the chat (D-155)

Cause: a failed / interrupted / stopped turn lived only in the client `DashboardChatStore` (disposed on leaving the page); the reloaded thread mapped every reply to `done`. Fix: the outcome is stored per reply (`outcome`, `errorCode`, migration v11), Stop goes through `POST …/chat/stop`, Retry re-runs the turn in place with `retryOf` (no duplicate user message, 409 `not_retryable` otherwise). The global Ask FMS store already survives closing the panel; now covered by tests.

- Server: `mock-server/tests/d155-turn-outcome.test.ts` (error / refusal / client abort / provider cut / Stop stored; user message stored when setup fails; `retryOf` replaces in place with the change set carried over and still undoable; 409 when not latest, already done or another user's thread). `f19-dashboard-chat` client-abort note now "(interrupted)".
- Client: `dashboard-chat.test.tsx` (Retry shown after a fresh load for each outcome; Stop posts `/chat/stop` then aborts; retry after load sends `retryOf` and keeps one user message; 409 reloads; global panel unmount/remount keeps Retry); `chat-ux.test.tsx` F23-T2 retry now sends `retryOf`.
- e2e `d155-retry-persists.spec.ts`: leave mid-answer → `/dashboards` → back → Interrupted + Retry → done with one user message; provider cut → reload → Retry → done, thread `done` ×2; global panel close/reopen keeps Retry.

## Screenshots (`FMS_SHOTS=1`)

`screenshots/chat-progress.png`, `interrupted.png`, `starter.png`, `type-ahead.png`.
