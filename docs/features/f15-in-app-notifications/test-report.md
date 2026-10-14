# F15 — Test report

Branch `feature/f12-f15` (with F12 and DS2). **UAT accepted 2026-10-14**; merged into `main`.

## How it was delivered
The F15 agent built the store, shared events socket, bell, lazy panel, items, links, toast policy and unit/component tests, then was stopped by the user. The orchestrator added the e2e specs and screenshots in session 8. Testing kept light at the user's request.

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` / `pnpm build` | see F12 report (same run); `notification-panel` lazy chunk 2.3 kB gzip |
| `e2e/notifications.spec.ts` (chromium) | **2/2** |
| `e2e/notifications.clock.spec.ts` (clock) | **1/1** |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F15-T1 | pass | `notification-store.test.ts` |
| F15-T2 | pass | `events-socket.test.ts` |
| F15-T3 | pass | `notification-bell.test.tsx` (badge 99+, aria-label, tabs, mark all read, navigate, toast cap + "+N more") |
| F15-T4 | pass | clock spec: moving the mock clock past the next 24 h no-GPS mark raises a critical toast; Open selects that vehicle; the out-of-scope Viewer gets no toast. The spec predicts the vehicle from the seeded sim but accepts whichever alert fires first (the prediction can differ slightly from the live mock) |
| F15-T5 | pass | a request created as the seed driver reaches the super admin within 5 s (badge "1"); Mark all read clears it and it stays cleared after a reload |
| F15-T6 | pass | `screenshots/`: bell-badge, panel-desktop, sheet-mobile, critical-toast |
| F15-T7 | partial | full e2e + perf not run (user asked to relax testing) |
