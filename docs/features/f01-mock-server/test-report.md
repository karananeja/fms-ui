# F01 — Mock Server & API/WS Contract · Test Report

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Branch | `feature/f01-mock-server` |
| Env | macOS, Node 24.14, pnpm 10.33, Vitest 5.0.4, Playwright 1.64 (Chromium), zod 4.6, Fastify 5.12 |
| Result | **All passed** (no BLOCKED items) |

## Acceptance tests

| ID | Type | Result | Command | Evidence |
|---|---|---|---|---|
| F01-T1 | contract | PASS | `pnpm test` | `mock-server/tests/rest-contract.test.ts` (5 tests) sweeps every REST endpoint (health, auth, permissions, fleets CRUD, vehicles list/search/cursor/move, users, roles, invites, share links, public share + trail, dev mailbox/clock/stats, 401/403/404/409/410/422 envelopes). The harness `api()` parses **every** response in **all** integration suites: errors against `errorResponseSchema`, 202/204 as empty, others against a required schema. |
| F01-T2 | contract | PASS | `pnpm test` | `ws-contract.test.ts › ops gets subscribed, then snapshot chunks, then a delta within 2 × MOCK_BATCH_MS` (484 ms): `subscribed` first, chunks 0…n-1 (chunk 200 rows), rows = North `vehicleCount`, first delta ≤ 1000 ms after the last chunk, seq strictly increasing, every row parsed with `rowSchema(fields)`, `invalid` (messages failing `serverMessageSchema`) empty. Also lafparsed fleet PIDs, vehicle-scope payloads (strict schemas, 374 PIDs), ping/pong, duplicate id, 4401. |
| F01-T3 | unit | PASS | `pnpm test` | `vehicle-sim.test.ts › is deterministic for the same seed and time, and yields MOCK_VEHICLES rows` (100k, 232 ms): two generators with seed 42 give equal rows / `combinfo` / `lafparsed`; 100 000 rows; another seed differs. |
| F01-T4 | unit | PASS | `pnpm test` | `vehicle-sim.test.ts › raw fields over 100k vehicles produce every F05 status` (204 ms). Reference F05 rules in the test, fed only with wire fields (combinfo live row + lafparsed `mcu_charge_plug_status` / `charger_status`). Mix at seed 42: running 34.6%, stopped 34.3%, non-comm 8.2%, charging 8.0%, no-gps 5.1%, pullout 4.9%, immobilized 3.9%, gps-never 1.1%; each within ±5 pp of the spec (whose shares sum to 96%). |
| F01-T5 | integration | PASS | `pnpm test` | `scope.test.ts`: viewer sees only `Delhi Hub 1` + its 2 teams; snapshot rows = hub `vehicleCount`, every `fleetId` in the hub subtree, deltas only for snapshot vehicles; fleet `f1` → close `4403`; vehicle outside hub → `4403`; admin REST → `403`. |
| F01-T6 | integration | PASS | `pnpm test` | `auth-flows.test.ts` (4 tests): login → me → logout → me `401`; bad password `401 invalid_credentials`; forgot (unknown email also `202`) → mailbox → weak password `422` → reset `204` → reuse `410` → old password `401` → new password `200`; reset token after +31 min (dev clock) `410`; invite → token info → weak `422` → accept `200 Me` + cookie → login; used token `410`; invite after +7 d `410` (info and accept). |
| F01-T7 | integration | PASS | `pnpm test` | `share-links.test.ts` (4 tests): create `201` (32-byte base64url token, `/share/:token`) → public `200` → trail points → share WS payload without `speed/deviceid/carbattery/devbattery/rxdbm`, `parsedcandata` = `immobilization_status` only, lafparsed → `error forbidden` → revoke `204` → socket `4410` → public + trail `410` → new socket `4410`. Full groups when shown; other scope `4403`; expiry via dev clock closes with `4410`; trail disabled `404`; viewer create `403`. |
| F01-T8 | integration | PASS | `pnpm test` | `fleets.test.ts`: 6th level `422 max_depth`, level 5 `201`, moving a city under a team `422 max_depth`, non-empty delete `409`. Moves: root subscriber gets a delta with the full field set and the new `fleetId` for all 3 moved vehicles; ops (North) gets an "enter" delta for the 2 incoming vehicles and `[[vehicleId, null]]` for the one that left (D-024); `/api/vehicles?fleetId=` lists them. |
| F01-T9 | perf | PASS | `pnpm perf:mock` | See below. |

Unit/integration totals: `Test Files 12 passed (12) · Tests 42 passed (42)` in ~1.0 s (incl. 8 F00 tests). Max single test 978 ms (`scope` waits for a real delta); no test raised its timeout.

### F01-T9 numbers (`pnpm perf:mock`, mock in a child process, client on the same machine)

| Metric | 1 lakh (budget) | 10 lakh (info only) |
|---|---|---|
| Boot to healthy | 423 ms | 826 ms |
| Snapshot rows / size | 100 000 / 22.7 MB | 1 000 000 / 227.9 MB |
| Snapshot to client | **204 ms** (≤ 2000) | 1798 ms |
| Mock CPU, steady state (20 s / 10 s window) | **0.040 cores** (< 1) | 0.298 cores |
| Delta rows / s | 9 187 | 92 008 |
| Mock RSS / heap used | 247 MB / 30 MB | 391 MB / 71 MB |

Output: `F01-T9 PASS: snapshot 204 ms (budget 2000), CPU 0.040 cores (budget < 1)`.

## Commands

| Command | Exit | Notes |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean, `eslint .` 0 problems, `vitest run` 42/42 |
| `pnpm build` | 0 | `dist/assets/index-*.js 375.73 kB (gzip 121.09 kB)`; mock/shared code is not in the bundle yet |
| `pnpm e2e` | 0 | `5 passed (3.4s)`: F00's 3 + `mock-proxy.spec.ts › /ws/live works through the Vite proxy with the session cookie` (subscribed → snapshot via `ws://localhost:5173/ws/live`) + `/ws/live without a session closes with 4401 through the proxy`. Ports 5173/4000 free afterwards. |

## Contract deviations / clarifications vs the spec

All are logged as Proposed decisions; the schemas in `shared/contract/` are authoritative.

1. **Move deltas carry metadata** (D-024): spec says combinfo deltas never repeat metadata; vehicles that moved are sent once with the full snapshot field set, and vehicles that left a scope as `['vehicleId','fleetId']` with `fleetId: null`.
2. **`displayStatus` is never sent** (D-025): allowed by the spec ("may").
3. **Share + hidden `drivingEnergy` + `lafparsed`** → `error {code:'forbidden'}`, socket stays open (spec: "removes the whole lafparsed topic"). "Energy-related parsedcandata" = everything except `immobilization_status`; hidden `device` also strips lafparsed `deviceid` (D-026).
4. **Unknown share token on WS → `4401`** (spec lists `4410` for expired/revoked only); WS subscriptions require `live.view` (D-027).
5. **`GET /api/share-links`** also accepts `share.revoke` without `share.create` (D-028).
6. **Extra dev endpoint** `GET /api/dev/stats` (D-029).
7. Unspecified shapes fixed in D-028 (bare-array lists, `201` on create, `[{id,label}]` permission catalogue, `/api/vehicles?fleetId=` = direct members, 409 cases).
