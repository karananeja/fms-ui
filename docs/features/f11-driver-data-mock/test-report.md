# F11 — Test report

Branch `feature/f11-driver-data` in the main checkout. **Ready for UAT.** Not merged; nothing here is accepted until UAT.

## How it was delivered
The F11 agent wrote the contract, generators, stores, routes and WS changes, then stopped when the account hit its weekly usage limit (resets 2026-10-19). The orchestrator finished it in session 7: wrote the F11 tests (T1–T8), fixed two defects the tests found (below), formatted the files and ran the final verification.

## Final runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass: **716/716** in 63 files (main 679 + 37 new F11 tests); Prettier clean |
| `pnpm build` | pass (the > 500 kB warning is the existing MapLibre chunk) |
| `pnpm playwright test --project=setup --project=chromium` | **54/55**. The one failure, F09-T8 (tray updates after a pan), **fails the same way on `main`** (checked on a clean `main` at the same time), so it is a pre-existing, time-dependent flake, not an F11 regression. Follow-up below |
| `pnpm playwright test --project=setup --project=clock --no-deps` | **4/4** (incl. F05-T8: status counts still sum to 1 lakh) |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F11-T1 | pass | `generator/driver-history-sim.test.ts` (5): DriverSim and HistorySim are deterministic for a seed. Driver count = ⌊0.85 × vehicles⌋, only `normal` vehicles are assigned, 1:1. Every vehicle-day: uptime + downtime = 24 h, drive + idle = uptime, idle ≥ 0, distance = drive h × speed. Partial-day weighting across IST days. |
| F11-T2 | pass | `store/requests.test.ts`: breakdown and RSA flows with the timeline appended. Invalid transitions → 409, dispatch without assignee/ETA → 422, a second open request of the same type → 409, a driver without a vehicle → 409. |
| F11-T3 | pass | Same file: suggestions are in the same fleet, unassigned, stopped/charging, SOC ≥ 40 % (EV) and range ≥ 60 km, nearest first. Approve moves the assignment and keeps history. `waiting` when nothing qualifies, then `suggested` once a vehicle frees up. Auto-assign records `system`. Override → 409 (taken) / 403 (out of scope). |
| F11-T4 | pass | `generator/no-gps-insight.test.ts` (9): the priority order for each cause; insights only for no-GPS vehicles, with ≥ 3 distinct seeded causes. |
| F11-T5 | pass | `tests/f11-contract.test.ts`: every response validated against its zod schema. Driver: own data only, staff endpoints 403, cannot act on requests. Assigning a taken vehicle → 409. No-GPS insight 200 / 404 (healthy) / hidden out of scope. Analytics: Operator scoped, Viewer 403, a 100-day window 422. Notifications list + mark-all-read. |
| F11-T6 | pass | Same file: a driver subscribing `combinfo` is closed with 4403; `events` with `self` works. A request update reaches the driver and the root admin, but not a Viewer outside that fleet. |
| F11-T7 | pass | `tests/f11-clock.test.ts`: moving the mock clock past 24 h of no-GPS raises exactly **one** `critical` `no-gps-24h` for that vehicle-episode (none before, still one 30 min later), visible to the super admin, not to the out-of-scope Viewer. |
| F11-T8 | pass | `tests/f11-budgets.perf.test.ts` at 1 lakh (best of 3), see below. |
| F11-T9 | pass* | rows above (*the F09-T8 flake is pre-existing). |

## Budgets (spec §7, 1 lakh vehicles, load avg ≈ 2.5)
| Query | Measured | Budget |
|---|---|---|
| Analytics summary, root fleet, 30 days | 310 ms | ≤ 500 ms |
| Analytics summary, root fleet, 90 days | 883 ms | ≤ 1.2 s |
| One fleet (f42, 4,869 vehicles), 90 days | 43 ms | ≤ 100 ms |
| `GET /requests/:id/suggestions` | 0.5 ms | ≤ 50 ms |
| 24 h no-GPS job tick | 0.8 ms | ≤ 20 ms |
| Mock build + ready (incl. F11) | 117 ms | increase ≤ 300 ms |

**Generator facts at 1 lakh:** 85,000 drivers, 65,313 assigned. 5,062 no-GPS vehicles, 1,528 (30.2 %) past 24 h at start-up (maximum ≈ 5 days). Seeded causes are spread evenly (1,275 / 1,285 / 1,307 / 1,195).

## Defects found and fixed during testing
1. **History days didn't add up to 24 h.** A non-communicating vehicle with a breakdown and charging could get drive + downtime > 24 h, so idle went negative (−2.9 h) and the dashboard would show uptime + downtime ≠ 24 h. Downtime is now capped to the time left after driving (`history-sim.ts`).
2. **No-GPS 24 h alert severity** was `warning`; the signed-off F15 spec (R5) says `critical`. Changed in `store/notifications.ts`.

## Deviations from the spec
- Forbidden WS subscribes close the socket with **4403** (the existing F01 convention), rather than sending an `error` message. Spec §6 says "→ forbidden".
- The spec's "≈ 30 % older than 24 h" is achieved with seeded **episode lengths**: most no-GPS episodes restart every 3–20 h, and a long share runs for days.
- The Operator role also gained `chat.use` and `analytics.view` (spec §6), so `ops@fms.local` will see Analytics (F16) and the assistant (F17) once those ship.

## Follow-ups (not F11)
- **F09-T8 tray flake:** it fails on both `main` and this branch at the time of testing (passed in the morning baseline), so it is time-of-day dependent. Worth a small fix in the tray test (choose the pan target from live data) before the next merge cycle.
