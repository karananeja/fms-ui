# F05 — Vehicle Status Derivation · Test Report

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Branch | `feature/f05-vehicle-status` |
| Env | macOS, Node 24, pnpm 10.33, Vitest 5.0.4, Playwright 1.64 (Chromium), Vite 8.3 dev server for e2e (the user's running `pnpm dev`, reused) |
| Result | **All passed** (no BLOCKED items) |

## Acceptance tests

| ID | Type | Result | Command | Evidence |
|---|---|---|---|---|
| F05-T1 | unit | PASS | `pnpm test` | `worker/status-deriver.test.ts › F05-T1`: a 44-case table plus a check that every status is covered. It covers each rule positive and negative; boundaries at equal, +1 ms and −1 ms for 30 min / 10 min, 1.0 / 0.99 / 1.01 V and speed 2 / 2.01 / 1.99; gps-never for `0,0`, NaN, missing and null (only one coordinate 0 → not gps-never); charging with `null`, NaN and absent PIDs → stopped, for both `equals` and `notEquals`; ignition on + speed 0 → stopped; ignition missing + speed 60 → stopped. Conflicts: non-comm+pullout → non-comm, pullout+charging → pullout, immobilized+running → immobilized, and 5 more. |
| F05-T2 | unit | PASS | `pnpm test` | `› F05-T2` (15 tests): a reordered priority makes immobilized+running → running; new thresholds apply (5 min non-comm, 2 min no-gps, 9 V pullout, 50 km/h running); a different charging PID (`bms_charging_state = 2`) and immobilized field (`immo_pid`) are evaluated and become the fleet lafparsed PIDs (`statusLafPids`); the default config validates. 11 invalid configs are rejected with `Invalid status rules config:` and a path-specific message: unknown status, duplicate, missing, `stopped` not last, zero / negative / infinite threshold, zero sweep interval, empty `anyOf`, condition without a value, typo key. Engine: injected rules change the `lafparsed` subscription `pids`, and invalid rules throw in the constructor. |
| F05-T3 | unit | PASS | `pnpm test` | Tracker with explicit fake `now`: no change at exactly +10 min, both vehicles `no-gps` at +10 min 1 s, a fresh delta brings one back to stopped, `non-comm` after +30 min; counts follow; lafparsed rows re-evaluate. Engine with fake timers and no messages: 3 vehicles go stopped/running → `no-gps` (3) → `non-comm` (3) in the pushed `statusCounts`, and nothing is pushed while idle. Heartbeat `ts` +31 min → `non-comm` at the next sweep, so the server clock is used. |
| F05-T4 | unit | PASS | `pnpm test` | 3000 seeded random steps (snapshot inserts, deltas, lafparsed, leave rows, sweeps, snapshot reconciliation; capacity 2 → grows, which forces a recompile). After every step, `statusCounts` equals a recount of the status column, the sum equals `count`, and `total` equals `count`. After a final sweep, every vehicle equals `deriveStatus(summary, t)`. |
| F05-T5 | unit | PASS | `pnpm test` | `› F05-T5` (8 tests): a valid `displayStatus` overrides the rules (even gps-never); `'Running'`, `'parked'`, `''`, `3` and `null` are ignored; `preferServerStatus: false` ignores it; a `displayStatus` combinfo column in the fleet state is encoded, so `immobilized` wins and `bogus` falls back to the rules. |
| F05-T6 | integration | PASS | `pnpm test` | `worker/status-deriver.node.test.ts` (in-process mock, 2000 vehicles, superadmin): all 8 statuses are present and within ±5 points of D-030. The `lafparsed` subscribe frame has `pids = statusLafPids(statusRulesConfig)` = `['mcu_charge_plug_status','charger_status']`. For every vehicle, the vectorised status equals `deriveStatus(getVehicleSummary(id), now)`. Also, in F01-T4, `deriveStatus` (default config) agrees with the mock's reference function on **all 100 000** generated rows (0 mismatches). |
| F05-T7 | perf | PASS | `pnpm test` | `› F05-T7`: 100 000 synthetic vehicles (full lafparsed join, mixed statuses), 5 warm-up + 20 measured sweeps: **median 1.62–1.70 ms, max 1.74–1.78 ms** (assert median ≤ 20 ms; target 5 ms met). |
| F05-T8 | e2e | PASS | `pnpm e2e` | `e2e/vehicle-status.clock.spec.ts` (project `clock`, 1 lakh vehicles): Total **1,00,000**, and the 8 counts sum to 100 000. After `POST /api/dev/clock {offsetMs: 1 860 000}`, the diagnostics server offset reached **+1860.0 s** within the next heartbeat. Counts still sum to 100 000, and non-comm stayed at **8161**, not 100 000. The clock is reset to 0 in `afterEach`. |
| F05-T9 | cmd | PASS | see below | `pnpm check`, `pnpm build` and `pnpm e2e` all exit 0. |

## Measured status mix vs D-030

| Status | D-030 target | 1 lakh (e2e, live) | 2000 (T6, two runs) |
|---|---|---|---|
| running | ~35 | 34.6 % | 33.8–35.3 % |
| stopped | ~34 (remainder) | 34.3 % | 34.1–35.8 % |
| charging | ~8 | 8.0 % | 7.0–7.5 % |
| non-comm | 8 | 8.2 % | 9.8 % |
| no-gps | 5 | 5.1 % | 4.7 % |
| pullout | 5 | 4.9 % | 4.5 % |
| immobilized | 4 | 3.9 % | 3.4 % |
| gps-never | 1 | 1.1 % | 0.8 % |

1 lakh counts before the clock shift: running 34 643, stopped 34 303, immobilized 3898, non-comm 8161, charging 7982, pullout 4889, no-gps 5062, gps-never 1062 (sum 100 000).

## Sweep timing

| Where | Result |
|---|---|
| Node, F05-T7 (100 000 vehicles) | median **1.6–1.7 ms**, max 1.8 ms |
| Browser worker, dev server, headless Chromium, while streaming ~18 k rows/s (`stats.sweepMs`, 20 samples at 1 Hz) | 2.1–8.7 ms, most samples 3–6 ms; 3.7 ms in the final T8 run |

The first implementation (one closure per rule) measured 4.2 ms in Node and 5–14 ms in the browser. The single-switch evaluator brought it to the figures above. The browser numbers come from the unbundled dev server and are noisier. Some samples are still above the 5 ms target; all are well under the 20 ms bound.

## Other checks

- F04 perf budgets still hold with F05 in the worker: first data 569 ms, snapshot 821 ms, 0 long tasks, **3.33 pushes/s** (≤ 4), state 35.5 MB.
- Push coalescing is unchanged. Status changes only mark the push dirty, and the sweep pushes only when something changed (the engine T3 test shows no pushes while idle).
- `no-react-imports.node.test.ts` now also scans `status-deriver.ts` (and its tests).

## Commands

| Command | Exit | Output |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean · `eslint .` 0 problems · `Test Files 20 passed (20) · Tests 170 passed (170)` (~5.5 s) |
| `pnpm build` | 0 | `live-tracking-worker-*.js 46.29 kB` (was 17.3 kB; zod/mini, D-036) · `index-*.js 391.15 kB │ gzip 126.19 kB` |
| `pnpm e2e` | 0 | `8 passed (24.2s)`: 5 × chromium, 2 × perf (F04-T9/T10), 1 × clock (F05-T8) |

Ports 5173/4000 were held by the user's `pnpm dev`, so Playwright reused it. Nothing was started or killed by this run. The mock clock was reset to 0 afterwards.

## Deviations from the spec / clarifications

1. **F05-R1 placement** (D-037): `FleetState` gains the `status` column (via `addColumn`), but the counts (`Uint32Array(9)`, indexed by status code, slot 0 unused) and `total` (= `state.count`) are owned by `StatusTracker` in `status-deriver.ts`. It hooks into `FleetState` through the F04 hooks, so `fleet-state.ts` knows nothing about status rules.
2. **zod in the worker** (D-036): the spec requires zod validation at worker start, so the worker now loads `zod/mini` plus its English locale. This partly revises D-032, and the worker chunk is 46 kB instead of 17 kB.
3. **Extra files**: `config/status-rules-schema.ts` (keeps zod out of anything that imports only the config) and `components/status-pill.tsx`.
4. **`displayStatus` in the fleet state**: stored as an encoded `Uint8` column (`addColumn(name, Ctor, encode)`). An invalid value is stored as 0 and ignored.
5. **Push / stats additions**: `LiveStats.sweepMs`, shown as "Status sweep" in diagnostics. `SelectedVehicle.status` is `null` when the vehicle is not in the fleet state. `selected` is re-pushed when the selected vehicle's status changes.
6. **Validation detail**: when `priority` contains an unknown ID, zod reports that first. Duplicate and missing checks run once every entry is a known status.
7. **Missing data**: a missing ignition makes `running` false, missing timestamps never trigger non-comm or no-gps, and a missing `carbattery` is not pullout. This follows "comparisons are strict, exactly as written".
8. **F04 engine fix** (D-039): `stats.snapshotComplete` resets to `false` when the fleet subscriptions are re-sent on reconnect. This fixes a pre-existing intermittent F04-T5 failure, which also failed on `main` in 4 of 6 runs.
9. **T6 target** (D-040): uses the D-030 mix (stopped ≈ 34 %) instead of F01-T4's 30 %, which was taken at a fixed instant. Tolerance stays ±5.
10. **T8 project** (D-038): the spec shifts the shared mock clock, so it runs in its own Playwright project `clock` after `perf`.
