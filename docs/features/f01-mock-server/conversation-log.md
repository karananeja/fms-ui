# F01 — Mock Server & API/WS Contract · Implementation Log

Implementation sub-agent, 2026-10-13, branch `feature/f01-mock-server` (base: F00 on `main`).

1. **Read inputs**: F01 spec + intent, F05/F03/F10 intents, architecture, decision log, README, F00 mock stub and configs, `caninfo.md`, `lafparsed.md` (374 PIDs, all `{pidvalue:number, valtype:2, timestamp}`).
2. **Deps**: `zod` 4.6 (runtime dep, shared with the UI); dev: `@fastify/websocket` 11, `@fastify/cookie` 11, `ws` 8 + `@types/ws` (test/perf client).
3. **Contract** (`shared/contract/`): `common` (epoch ms, error envelope), `password-policy` (D-018), `permissions` (11 + labels), `access` (fleet, role, user, invite, vehicle meta, requests), `auth` (login, Me, forgot/reset/accept), `share-links`, `payloads` (strict `combinfo` / `lafparsed` schemas from the samples, share redaction groups + redacted variants), `ws` (client/server messages, close codes, fleet column lists, per-column `rowSchema`), `dev`.
4. **Fixtures**: copied the two samples to `mock-server/fixtures/*.json` (D-023); a test asserts they equal the `.md` files.
5. **Generator** (`mock-server/generator/`):
   - `fleet-tree`: 1 org → 4 regions → 20 cities → 60 hubs → 120 teams (205 fleets), index-addressed nodes, scope masks (`Uint8Array` per fleet), depth checks.
   - `vehicle-sim`: typed arrays of static per-vehicle parameters (~47 B/vehicle); persona + duty cycle (D-030); position = closed lobed loop around one of 40 city centres, a pure function of distance driven, so trails are recomputed. Metadata strings (id, deviceId, regno, VIN) are derived from the index via bijections, so they are unique and never stored.
   - Sanity run: 100k init 50 ms; 1M init 460 ms; snapshot build + stringify 100k ≈ 220 ms.
   - Problem: `reportIndex` missed reports pulled earlier by negative jitter (only ~2.6% of vehicles reported per 500 ms instead of ~4.6%). Fix: start one interval ahead and step back.
   - Problem: odometers were counted from 1970 (11 M km). Fix: duty cycles anchored at 2026-09-01.
   - Problem: frozen outage timestamps were fractional (failed the `int` schema). Fix: rounded.
6. **REST** (`routes/*`, `store/*`, `context.ts`): cookie sessions (12 h sliding, re-issued on each request), scrypt passwords, permission + fleet-scope guards, `HttpError` → error envelope, zod failures → `422 validation_failed` + `details`. Details beyond the spec in D-028.
7. **WS** (`live/live-hub.ts`): cookie or `?share=` auth; chunked snapshots sent with back-pressure (await each `send`); a 500 ms flush scans `reportAt(i, now) > since` (≈4 ms at 100k) and sends shared, cached rows per subscription; move deltas (D-024); share redaction (D-026); share expiry checked each flush; 15 s heartbeat.
   - Replaced Fastify's deprecated `disableRequestLogging` with `logController: new LogController({ disableRequestLogging: true })`.
8. **Tests**: harness (`mock-server/testing/harness.ts`) starts an in-process server on port 0 with 2000 vehicles; `api()` validates **every** response (error envelope / empty / schema); `LiveClient` validates every WS message and has only bounded waits.
   - Problem: the fixture test in `shared/` failed `tsc -b` (app config has no Node types). Fix: moved it to `mock-server/tests/payload-contract.test.ts`.
   - T4 tolerance: the spec mix sums to 96%, so "stopped" lands at ~34%; asserted each status within ±5 pp.
   - T3/T4 at 100k run in ~0.2 s each, so no per-test timeout raise was needed.
9. **e2e**: `e2e/mock-proxy.spec.ts` opens `/ws/live` from the browser through Vite (`ws: true` proxy) with the session cookie, and checks `4401` without one.
   - Problem: `location` is not typed under the Node tsconfig used for `e2e/`. Fix: compute the WS URL in the test and pass it into `page.evaluate`.
10. **Perf (T9)**: `pnpm perf:mock` spawns the mock as a child process, measures snapshot-to-client time and reads the mock's own CPU from `GET /api/dev/stats` (D-029). Ran once at 100k (PASS) and once at 1M (for the record).
11. **Docs**: README (env, seed logins, dev endpoints, scripts), `.env.example`, decisions D-023…D-030, test report, catalogue row.
