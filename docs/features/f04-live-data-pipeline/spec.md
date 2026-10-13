# F04 — Live Data Pipeline · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Branch | `feature/f04-live-data-pipeline` |
| Contract | `shared/contract/ws.ts`, `payloads.ts`, `auth.ts` (F01, incl. D-024…D-028) |

## 1. Files (kebab-case)

```
src/features/live-tracking/
  config/live-tracking-config.ts     all tunables (push rate, backoff, heartbeat timeout, fleet lafparsed PIDs)
  worker/live-tracking-worker.ts     Worker entry: Comlink.expose(new LiveTrackingEngine(...))
  worker/live-tracking-engine.ts     orchestrates socket, state, subscriptions, push (no `self`, testable in Node)
  worker/ws-client.ts                connect, backoff, heartbeat watchdog, server-clock offset
  worker/fleet-state.ts              struct-of-arrays vehicle store
  worker/worker-api.ts               the typed API exposed to the main thread (shared type)
  store/live-tracking-store.ts       main-thread class (no React imports)
  store/use-live-tracking.ts         useSyncExternalStore hook with selector
  components/live-feed-diagnostics.tsx  temporary panel on /live-tracking (replaced by F06–F08)
src/app/dev-session.ts               dev-only auto sign-in until F02 lands
```

## 2. Requirements

### Startup & session
| ID | Requirement |
|---|---|
| F04-R1 | `main.tsx` renders the app, then calls `bootstrapLiveTracking()`. That function gets the session (`GET /api/auth/me`), then calls `liveTrackingStore.start(me)`. This opens the WS as soon as the app has loaded. |
| F04-R2 | **Dev sign-in (temporary).** If `/me` returns `401` **and** `import.meta.env.DEV`, `dev-session.ts` signs in automatically with `POST /api/auth/login`. It uses `VITE_DEV_LOGIN_EMAIL` / `VITE_DEV_LOGIN_PASSWORD` (default `superadmin@fms.local` / `Admin@123`, documented in `.env.example`). Production builds never contain this code path. F02 replaces it. |
| F04-R3 | The store starts once. Calling `start()` again does nothing. `stop()` terminates the worker. |

### Worker: socket (`ws-client.ts`)
| ID | Requirement |
|---|---|
| F04-R4 | Connects to `${location.origin.replace(/^http/,'ws')}/ws/live`, so the cookie is sent same-origin. The socket factory is injectable so Node tests can use the `ws` package with a Cookie header. |
| F04-R5 | **Reconnect** uses exponential backoff with full jitter: `min(30 s, 500 ms × 2^attempt) × random()`. The attempt count resets once a snapshot completes. |
| F04-R6 | **Heartbeat watchdog:** if nothing arrives for `2 × HEARTBEAT_MS` (30 s), the client closes and reconnects. |
| F04-R7 | **Close codes:**<br>• `4401`: state becomes `unauthenticated`, with **no reconnect**.<br>• `4403`: state becomes `error`, with no reconnect.<br>• Anything else: `reconnecting`. |
| F04-R8 | **Server clock:** every `heartbeat.ts` updates `serverOffsetMs = ts − Date.now()`. `engine.now()` returns `Date.now() + serverOffsetMs`. All freshness logic, including F05, uses `now()`. |

### Worker: subscriptions
| ID | Requirement |
|---|---|
| F04-R9 | On every (re)connect the worker sends two subscriptions:<br>• `combinfo` with fleet scope, `fleetIds = me.fleetIds`.<br>• `lafparsed` with fleet scope, the same fleet IDs, and `pids = config.fleetLafPids`. Default: `['mcu_charge_plug_status','charger_status']`. F05 will source these from the status-rules config. |
| F04-R10 | `selectVehicle(id)` adds a `combinfo` and a `lafparsed` subscription with vehicle scope. The worker keeps the latest **full** payload of each. `selectVehicle(null)` or choosing another vehicle unsubscribes the previous one. The selection is re-subscribed after a reconnect. |

### Worker: fleet state (`fleet-state.ts`)
| ID | Requirement |
|---|---|
| F04-R11 | **Struct-of-arrays layout:**<br>• Dense indices `0..count-1`.<br>• Capacity doubles as it grows.<br>• Numeric columns are typed arrays: `Float64Array` for lat/lng and the three timestamps; `Float32Array` for speed/heading/soc/dte/odometer/carbattery/devbattery; `Int8Array` for ignstatus/fixquality/immobilization_status.<br>• Each lafparsed PID gets its own `Float32Array`, with `NaN` meaning null.<br>• Low-cardinality strings (fleetId, assetType, fuelType, make, model, variant) are dictionary-encoded as `Uint16Array` + string table.<br>• Unique strings (vehicleId, deviceId, regno, vin) are kept in `string[]`.<br>• Maps: `vehicleId→index` and `deviceId→index`. |
| F04-R12 | **Row handling:**<br>• Snapshot rows and full-field delta rows insert or update.<br>• Live-field delta rows update.<br>• A row with `fleetId: null` removes the vehicle (D-024), using **swap-remove** so the arrays stay dense.<br>• A `version` counter increments on every change. |
| F04-R13 | **Ordering:**<br>• A `combinfo` row is ignored if its `utctime` is older than the stored one.<br>• A `lafparsed` row is ignored if its `canutctime` is older than the stored lafparsed time. |
| F04-R14 | **Join:**<br>• `lafparsed` rows are joined to vehicles by `deviceId`.<br>• Rows for unknown devices wait in a pending buffer: latest row per device, at most 20 000 entries, oldest dropped first.<br>• The buffer is applied when the vehicle arrives, and cleared 60 s after the snapshot completes.<br>• Rows for vehicles no longer in scope are ignored. |
| F04-R15 | **Reconciliation after reconnect:**<br>• Vehicles absent from the completed new snapshot are removed.<br>• There are no duplicates.<br>• The UI keeps showing the old state while the new snapshot streams in. |

### Worker → main thread
| ID | Requirement |
|---|---|
| F04-R16 | **The worker API is typed** (`worker-api.ts`) and exposed with Comlink. F04 ships `init(me, onPush)`, `selectVehicle(id \| null)`, `getVehicleSummary(id)` and `dispose()`. Later features add query methods: viewport clusters, search, table window, CSV. |
| F04-R17 | **Push** goes through the `onPush` callback (Comlink proxy) and is **coalesced to ≤ `config.pushHz` (4 Hz)**. It is sent only when something changed. The payload is small and contains the following:<br>• `{connection, stats, version, selected?}`.<br>• `stats` is `{vehicleCount, snapshotComplete, rowsPerSec, msgsPerSec, lastMessageAt, reconnects, stateBytes, serverOffsetMs}`.<br>• `selected` holds the full `combinfo` and `lafparsed` of the selected vehicle, or null. |
| F04-R18 | **The fleet never leaves the worker.** The main thread only receives push payloads and query results. The largest is one vehicle's full payloads, about 25 KB. |

### Main thread: `LiveTrackingStore`
| ID | Requirement |
|---|---|
| F04-R19 | `class LiveTrackingStore`: the constructor takes `{ createWorkerApi: () => Remote<LiveTrackingWorkerApi> }` (dependency injection for tests).<br>Public methods: `start(me)`, `stop()`, `subscribe(listener) → unsubscribe`, `getSnapshot()`, `selectVehicle(id \| null)`.<br>The snapshot is an immutable `LiveTrackingState` object, replaced only when something changed: `{connection, stats, selectedVehicleId, selected}`.<br>A module-level singleton `liveTrackingStore` is exported. |
| F04-R20 | **No React imports** in `store/live-tracking-store.ts` or anywhere under `worker/`. The F04 test enforces this. |
| F04-R21 | `useLiveTracking(selector, isEqual = Object.is)` wraps `useSyncExternalStore`. Components re-render only when their selected slice changes. |

### Diagnostics panel (temporary, for UAT)
| ID | Requirement |
|---|---|
| F04-R22 | The `/live-tracking` page renders `<LiveFeedDiagnostics>`, which shows:<br>• Connection state (dot + label: Connecting / Live / Reconnecting / Offline / Signed out / Error).<br>• Vehicle count and whether the snapshot is complete.<br>• Rows/s and messages/s.<br>• Last message time (`formatIst`), reconnect count, worker state size (MB) and server clock offset.<br>• A **"Select vehicle"** input (vehicleId) that shows the selected vehicle's regno, lat/lng, speed, soc and lafparsed PID count, updating live.<br>F06–F08 replace this panel. |
| F04-R23 | In dev only, `window.__fmsLive` exposes counters for e2e tests: `{pushCount, firstDataAt, snapshotCompleteAt}`. |

## 3. Budgets (from `01-architecture.md` §1, at 1 lakh vehicles, default mock)
- First data shown ≤ 2 s after the WS opens. Full snapshot complete ≤ 5 s.
- No main-thread long task over 50 ms while streaming.
- Push rate ≤ 4 Hz.
- `stats.stateBytes` ≤ 60 MB.

## 4. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F04-T1 | unit | Backoff values stay within bounds and the cap. The attempt count resets after a snapshot. `4401` and `4403` stop reconnecting. The watchdog fires after 30 s of silence (fake timers). Heartbeats update the server offset. |
| F04-T2 | unit | `fleet-state`: insert, update, swap-remove keep both maps consistent. Capacity grows. Out-of-order rows are dropped. Strings are dictionary-encoded. `version` increments. |
| F04-T3 | unit | Join: lafparsed before combinfo goes to the pending buffer and is applied on insert. The buffer cap and expiry hold. Rows for out-of-scope vehicles are ignored. |
| F04-T4 | integration | The engine runs against the in-process mock (`MOCK_VEHICLES=2000`):<br>• As superadmin, the snapshot completes with 2000 vehicles, and deltas update the state.<br>• As viewer, the count equals the vehicles in the viewer's hub subtree. |
| F04-T5 | integration | The test kills the server socket. The engine reconnects, re-subscribes (including the selection) and reconciles, with the same count and no duplicates. A vehicle moved out of scope through `/api/fleets/:id/vehicles` is removed. |
| F04-T6 | integration | `selectVehicle` delivers a full combinfo payload and a lafparsed payload with 374 PIDs. Deselecting stops the payloads. |
| F04-T7 | unit | Store with a fake worker API:<br>• `getSnapshot` returns the same object until something changes.<br>• Listeners are notified, and unsubscribing works.<br>• `start` is idempotent.<br>• A source scan confirms there are no `react` imports under `store/live-tracking-store.ts` or `worker/`. |
| F04-T8 | unit | Push coalescing: with 100 changes per second (fake timers), at most 4 pushes per second are sent, and none while idle. |
| F04-T9 | e2e | Open `/live-tracking` with the default mock at 1 lakh vehicles. Check that:<br>• The dev sign-in happens.<br>• The diagnostics panel shows **Live** and a vehicle count of **100000**.<br>• `firstDataAt − navigationStart` ≤ 2000 ms, and the snapshot completes in ≤ 5000 ms (from `__fmsLive`).<br>• Selecting a vehicle shows its regno. |
| F04-T10 | e2e perf | After the snapshot completes, observe for 15 s and check that:<br>• `PerformanceObserver('longtask')` records **no task > 50 ms** on the main thread.<br>• `pushCount` grows by ≤ 4 per second.<br>The test records the numbers in the test report. |
| F04-T11 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. |

## 5. Out of scope
- Status derivation (F05). F04 stores the raw fields F05 needs.
- Map, search, filters and table queries (F06–F09).
- Resume from `seq` (D-027 / F01 out of scope).
