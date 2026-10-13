# F04 — Live Data Pipeline · Implementation Log

Implementation sub-agent, 2026-10-13, branch `feature/f04-live-data-pipeline` (base: F00 + F01 on `main`).

1. **Read inputs**: F04 spec + intent, architecture §4, decision log (D-005, D-024…D-030), README, F01 contract (`ws.ts`, `payloads.ts`, `auth.ts`), `mock-server/live/live-hub.ts`, harness, F01 test report; F05 spec for awareness only.
2. **Deps / contract**: added `comlink` 4.4. Moved the zod-free WS constants to `shared/contract/ws-protocol.ts` (re-exported from `ws.ts`) so the worker never loads zod (D-032).
3. **Worker** (`src/features/live-tracking/worker/`):
   - `ws-client.ts`: injectable socket factory + clock + random; full-jitter backoff `min(30 s, 500 ms·2^n)·random()`; 30 s watchdog re-armed on every frame; `4401` → `unauthenticated`, `4403` → `error` (no reconnect); heartbeat → `serverOffsetMs`; `send` only while open.
   - `fleet-state.ts`: struct-of-arrays (Float64 lat/lng/timestamps, Float32 metrics, Int8 flags, Float32 per PID with NaN = null, Uint16 dictionary codes, `string[]` ids), capacity doubling, swap-remove, `vehicleId`/`deviceId` maps, column plans cached per `fields` list, pending lafparsed buffer (latest per device, cap 20 000, oldest dropped), snapshot-epoch reconciliation, `addColumn` + `rowChanged`/`beforeRemove` hooks for F05, `bytes` estimate.
   - `live-tracking-engine.ts`: subscriptions on every open (fleet combinfo + lafparsed with `fleetLafPids`, plus the selection), snapshot epochs, pending-buffer window (D-034), selection with per-generation ids (D-033), push coalescing (≥ 250 ms apart, only when dirty), 1 s stats tick (rows/s, msgs/s; pushes only when the rates change).
   - `live-tracking-worker.ts`: `Comlink.expose(new LiveTrackingEngine(...))`, `onDispose: self.close()`.
4. **Main thread**: `LiveTrackingStore` (DI `createWorkerApi`, idempotent `start`, `stop` disposes + releases the proxy, immutable snapshots, selection, `metrics` for e2e), `useLiveTracking(selector, isEqual)` over `useSyncExternalStore` with a memoised selector, `bootstrap-live-tracking.ts` called from `main.tsx`, `dev-session.ts` loaded only via a dynamic import under `import.meta.env.DEV` (D-031), `LiveFeedDiagnostics` on `/live-tracking`.
   - Problem: `react-hooks/immutability` rejected a closure-mutating selector inside `useMemo`. Fix: moved the memo factory to a plain function.
   - Problem: `addColumn` generic inferred `Float64Array` from the column table. Fix: explicit `<Column>`.
5. **Tests**: fake socket helper; unit T1, T2, T3, T7, T8 (+ R21 hook test); Node-only `*.node.test.ts` (D-035) for the React-import scan and the engine-vs-mock integration tests T4–T6 using the F01 harness with the `ws` package and a `Cookie` header. All waits are bounded (`waitUntil` polls with a timeout).
   - Problem: the selection test asserted on the very last push, but a later stats push may follow. Fix: assert over pushes after the action.
6. **e2e**: `e2e/live-pipeline.perf.spec.ts` (T9, T10) in a separate Playwright project `perf` that runs after the others (D-035).
   - Problem: F01's "no session → 4401" e2e started failing because loading `/` now signs in automatically (F04-R2). Fix: it opens the socket from `/api/health` (same origin, no app bootstrap).
   - Problem: the long-task sanity check (a 120 ms busy loop via `page.evaluate`) was not recorded; CDP-evaluated scripts are not page tasks. Verified with a probe that page tasks are recorded, then ran the busy loop inside a page `setTimeout`. The observer is now proven to work in every T10 run.
   - A user `pnpm dev` session was already holding ports 5173/4000; the first runs reused it. It was stopped and the final `pnpm e2e` started its own servers. Ports were free afterwards.
7. **Build**: `pnpm build` with `VITE_DEV_LOGIN_*` set; grepped `dist/` for dev-login strings: none (D-031). Worker chunk 17.3 kB.
8. **Docs**: test report, decisions D-031…D-035, README (env + F04 section), catalogue row.
