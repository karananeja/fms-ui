# F12 — Test report

Branch `feature/f12-f15` in the main checkout (with F15 and DS2). **UAT accepted 2026-10-14**; merged into `main`.

## How it was delivered
The F12 agent built the API client, assign dialog, vehicle-card section and worker driver index, then was stopped by the user. The orchestrator finished it in session 8: drivers page, driver form, assignment history, route/nav/overview card, mounting the card section, moving assignment events onto the shared F15 socket, and the tests. On the user's request ("relax the testing"), only targeted e2e runs were done, plus one `pnpm check` and `pnpm build`.

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` | typecheck + lint clean; vitest **781/783**. The 2 failures are F11-T3 in `mock-server/store/requests.test.ts` (replacement engine): candidates depend on live SOC/status at wall-clock time, and no `mock-server/` file changed. They are a time-of-day flake like F09-T8 (follow-up) |
| `pnpm build` | pass; `drivers-page` lazy chunk 5.7 kB gzip |
| `e2e/drivers.spec.ts` (setup + chromium) | **6/6** |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F12-T1 | pass | `worker/driver-index.test.ts` (5): word-prefix match, ranking, move/unassign by event, unknown name resolved, fill once per prefix; budget 1 lakh build < 150 ms, match < 100 ms |
| F12-T2 | pass | `drivers/drivers.test.tsx` (9): form validation + server 409 inline + invite; assign dialog conflict "MH12AB1234 is driven by Ravi K. Reassign?" and inline 409; driver section none / assigned (manage) / read-only / live update; on-screen current-assignment cache |
| F12-T3 | pass | create in UI → assign → card shows driver "since < 1 min" → reassign → history 2 rows → unassign |
| F12-T4 | pass | assignment by another session appears on the open card within 5 s, and clears on unassign |
| F12-T5 | pass | Driver search field → "Name · regno" → card opens; Viewer sees driver read-only, no Drivers nav, page blocked |
| F12-T6 | pass | `screenshots/`: drivers-page, driver-form, assign-conflict, card-driver-section, card-desktop, card-mobile |
| F12-T7 | partial | check/build as above; full e2e + perf not run (user asked to relax testing) |

## Defects found and fixed
- Conflict text read "Ravi K.. Reassign?" (double full stop).
- The card's driver picker only listed drivers of the vehicle's leaf fleet, hiding drivers from parent fleets. It now lists any driver in the user's scope (the server still enforces scope).
- `Tile` dropped `data-testid`.

## Deviations (see D-095 / D-096)
- No compact driver endpoint in F11 → the worker fills its index per prefix from `GET /api/vehicles?driver=`.
- Driver list has no current vehicle → fetched for on-screen rows only.
- Admin overview card: "500+ active" past one page (no count endpoint).
- The fleet filter is the F03 picker inside a popover (the inline tree is too tall for a toolbar).
- "App access: Invited" is known only for invites sent from this tab (F11 driver has no invite reference).
