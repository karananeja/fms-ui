# F04 — Live Data Pipeline · Test Report

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Branch | `feature/f04-live-data-pipeline` |
| Env | macOS, Node 24.14, pnpm 10.33, Vitest 5.0.4, Playwright 1.64 (Chromium), Vite 8.3 (dev server for e2e) |
| Result | **All passed** (no BLOCKED items) |

## Acceptance tests

| ID | Type | Result | Command | Evidence |
|---|---|---|---|---|
| F04-T1 | unit | PASS | `pnpm test` | `worker/ws-client.test.ts` (7 tests, fake timers): backoff within `[0, min(30 s, 500·2^n)]` for attempts 0–19 and capped at 30 000 ms; reconnect delays 500 → 1000 → 2000, then 500 after `resetBackoff`; `4401` → `unauthenticated` and `4403` → `error` with no new socket after 120 s; watchdog closes at exactly 30 000 ms of silence (a frame at 29 999 ms re-arms it) and reconnects; heartbeat `ts` sets `serverOffsetMs` = 60 000 and `now()`. `live-tracking-engine.test.ts › the backoff attempt resets once a snapshot completes` (500, 1000, then snapshot → 500). |
| F04-T2 | unit | PASS | `pnpm test` | `worker/fleet-state.test.ts` (8 tests): typed columns, capacity 4 → 16 for 10 rows, both maps consistent after inserts and swap-removes (`fleetId: null`), out-of-order `utctime` and lafparsed `canutctime` dropped, `Uint16Array` dictionary codes (`['f0','f1']`), `version` increments per change and not on dropped rows, reconciliation removes vehicles absent from a completed snapshot. |
| F04-T3 | unit | PASS | `pnpm test` | `fleet-state.test.ts › F04-T3` (3 tests): lafparsed before combinfo → pending, applied on insert (an older pending row does not replace a newer one); cap 3 drops the oldest device first; after `closePending` rows for removed or unknown devices are ignored. `live-tracking-engine.test.ts › pending buffer closes 60 s after the snapshot completes` (still present at 59 s, cleared at 60 s, later unknown rows ignored). |
| F04-T4 | integration | PASS | `pnpm test` | `worker/live-tracking-engine.node.test.ts` (in-process mock, 2000 vehicles, `ws` + Cookie). Superadmin: snapshot complete with 2000 vehicles, id set equals the mock's, every vehicle has a joined lafparsed row, `version` grows on deltas (510 ms). Viewer: count = `Delhi Hub 1` `vehicleCount`, ids equal the hub subtree (30 ms). |
| F04-T5 | integration | PASS | `pnpm test` | Same file (994 ms), as ops (North): select a vehicle; a vehicle moved to South via `POST /api/fleets/:id/vehicles` is removed by the leave delta; the test terminates the server sockets and moves a second vehicle while the client is disconnected; the engine goes `reconnecting` → `live` (`reconnects` = 1), re-subscribes and reconciles: count = in-scope count (−2), id set equals the mock's, no duplicates (maps and `Set` sizes = count); selection payloads arrive again on `sel-c-2` / `sel-l-2`. |
| F04-T6 | integration | PASS | `pnpm test` | Same file, mock with a 1 s report interval (3.6 s): the pushed `selected.combinfo` passes the strict `combinfoSchema` and `lafparsed` has 374 PIDs (`lafparsedSchema`); ≥ 2 combinfo payloads arrive; after `selectVehicle(null)` the hub drops to 2 subscriptions and no selection payload arrives for 2.5 s. |
| F04-T7 | unit | PASS | `pnpm test` | `store/live-tracking-store.test.ts` (6 tests, fake worker API): `start` idempotent (one `createWorkerApi`, one `init`); `getSnapshot` identical until a push; listeners notified, unsubscribe works; selection only accepts payloads for the selected id, and `found: false` for unknown vehicles; metrics; `stop` disposes and releases the proxy, then `start` creates a new worker. `useLiveTracking` re-renders only when its slice changes (R21). `no-react-imports.node.test.ts`: 11 files (`store/live-tracking-store.ts` + everything under `worker/`) have no `react` / `react-dom` imports. |
| F04-T8 | unit | PASS | `pnpm test` | `live-tracking-engine.test.ts › 100 changes/s …` (fake timers, 300 deltas over 3 s): 3–4 pushes in each 1 s window (≤ 4); after the rates settle, 0 pushes over the next 5 s idle; the last push has `version` = state version and `rowsPerSec` 0. |
| F04-T9 | e2e | PASS | `pnpm e2e` | `e2e/live-pipeline.perf.spec.ts` (default mock, 1 lakh vehicles, fresh servers started by Playwright): `POST /api/auth/login` → 200 (dev sign-in), badge **Live**, count **1,00,000** (en-IN format of 100000), selecting `GET /api/vehicles?limit=1`'s vehicle shows its regno and `374` PIDs. Numbers below. |
| F04-T10 | e2e perf | PASS | `pnpm e2e` | Same file: 15.0 s window after snapshot completion, `PerformanceObserver('longtask')` installed by an init script. Numbers below. A 120 ms page task triggered after the window **is** recorded, which shows that the observer works. |
| F04-T11 | cmd | PASS | see below | `pnpm check`, `pnpm build`, `pnpm e2e` all exit 0. |

### Perf numbers vs budgets (1 lakh vehicles, default mock, Chromium via Vite dev proxy)

| Metric | Budget | Final run (fresh servers) | Earlier runs (reused dev server) |
|---|---|---|---|
| Time to first data (`firstDataAt`, from navigation start) | ≤ 2000 ms | **522 ms** | 489–501 ms |
| Snapshot complete (`snapshotCompleteAt`, from navigation start) | ≤ 5000 ms | **782 ms** | 744–760 ms |
| Main-thread long tasks > 50 ms while streaming (15 s) | 0 | **0** (none during page load either) | 0 |
| Push rate | ≤ 4 Hz | **3.07/s** (46 pushes / 15.0 s) | 3.06–3.26/s |
| `stats.stateBytes` (estimate) | ≤ 60 MB | **35.2 MB** | 35.2 MB |
| Stream rate seen by the worker | — | 18 018 rows/s (combinfo + lafparsed) | 18 200–18 862 |

Times are measured from navigation start, which is stricter than the budget's "after the WS opens".

Unit/integration totals: `Test Files 18 passed (18) · Tests 89 passed (89)` in ~5.3 s (47 of them are F04). Max single test: F04-T6 at 3.6 s (per-test timeout 15 s); every unit test is ≤ 5 ms.

## Commands

| Command | Exit | Notes |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean, `eslint .` 0 problems, `vitest run` 89/89 |
| `pnpm build` | 0 | `index-*.js 385.86 kB (gzip 124.51 kB)`; separate `live-tracking-worker-*.js 17.27 kB` (no zod, D-032) |
| `pnpm e2e` | 0 | `7 passed (21.0s)`: 5 × `chromium` (F00/F01) then 2 × `perf` (F04-T9, T10). Ports 5173/4000 free afterwards. |

### Dev sign-in tree-shake check (F04-R2, D-031)

`VITE_DEV_LOGIN_EMAIL=leakcheck@fms.local VITE_DEV_LOGIN_PASSWORD=Admin@123 pnpm build`, then `grep -rl <s> dist`:

| String | Files in `dist/` |
|---|---|
| `VITE_DEV_LOGIN` | 0 |
| `Admin@123` | 0 |
| `superadmin@fms.local` | 0 |
| `leakcheck` | 0 |
| `devSignIn` / `signing in as` / `dev-session` | 0 |
| `__fmsLive` | 0 |

## Deviations from the spec / clarifications

1. **`shared/contract/ws-protocol.ts`** (new, D-032): the WS constants were split out of `ws.ts`, which re-exports them, so nothing else changes. The split keeps zod out of the worker.
2. **`bootstrapLiveTracking`** lives in `src/app/bootstrap-live-tracking.ts`; the spec gives no file for it.
3. **Selection** (D-033): `selectVehicle` returns `boolean` and only subscribes when the vehicle is in the fleet state. Without this guard, an unknown id would get `4403` and close the whole socket. `SelectedVehicle` adds `found`. The store sets `selected = {found:false}` for unknown ids.
4. **Connection states** (D-033): `live` means the socket is open. `offline` means not started, disposed, or `navigator.onLine === false` during backoff.
5. **Pending buffer** (D-034): after 60 s it is closed as well as cleared, and it reopens on each reconnect. Rows with an equal timestamp are applied; only strictly older rows are dropped.
6. **Push `selected`** is included only when the selection or its payloads changed. This avoids re-cloning about 25 KB at 4 Hz. `lastMessageAt` is browser time.
7. **`stateBytes`** is an estimate: exact typed-array bytes, plus string characters + 24 B per string, plus 40 B per map entry, plus 200 B per pending row.
8. **`__fmsLive`** times are `performance.now()`, i.e. ms since navigation start.
9. **Test infrastructure** (D-035): Node-only tests use `*.node.test.ts` (tsconfig split). Perf e2e runs in a separate `perf` Playwright project after the other tests.
10. **F01 e2e changed**: `mock-proxy.spec.ts › without a session closes with 4401` now opens the socket from `/api/health`. Loading `/` now signs in automatically in dev (F04-R2), so it would have a session.
11. `useLiveTracking` takes an optional third argument `store` (defaults to the singleton) for tests.

## Hooks prepared for F05

- `FleetState.addColumn('status', Uint8Array)`: the column grows and swap-removes with the rest.
- `FleetStateOptions.hooks`: `rowChanged(i)` on every applied combinfo/lafparsed row, and `beforeRemove(i)` before swap-remove (for incremental counts).
- `engine.now()` is server-clock corrected. The `Clock` injection makes the sweep timer testable.
- `liveTrackingConfig.fleetLafPids` is the single place F05 replaces with config-derived PIDs.
- `LivePush`, `LiveStats`, `VehicleSummary` and `SelectedVehicle` are plain interfaces in `worker-api.ts`, ready for `statusCounts`, `total` and `status`.
