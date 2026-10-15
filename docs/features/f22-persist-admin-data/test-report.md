# F22 — Test report

Date: 2026-10-15 · Branch `feature/f22-persist-admin-data` · Node 24.14 · ports 5273/4101.

## Results per test

| ID | Where | Result |
|---|---|---|
| F22-T1 | `mock-server/db/database.test.ts` | Pass. v3–v7 on a fresh DB (25 tables) and on a v2 file with a dashboard (row kept, `CHECK(json_valid)` enforced); re-open no-op; newer-schema guard now reports v7; `atomic` nests, rolls back the outermost transaction, and nests inside `transaction()` |
| F22-T2 | `tests/f22-persistence.test.ts` | Pass. Empty file → `seed_state(42, 2000, 1)`, 4 seed logins, 205 fleets, driver link + driver user name; second start keeps salts and row counts; seed 43 and 1000 vehicles refused with the spec message; `dbReset` re-seeds (new salts, custom role gone). **F18-era v2 file with a dashboard** → migrates to v7, seeds, dashboard still listed for `u-superadmin` with owner name |
| F22-T3 | same | Pass. Custom role (create + rename), invited runtime user, pending invite, user fleet patch, fleet create/rename/re-parent, 3 vehicle moves, driver created with invite (linked on accept), edited and assigned, breakdown acknowledged, replacement `waiting`, auto-assign override, notifications read by id (super admin) and all (ops), one live and one revoked share link, runtime user's dashboard: all 21 reads identical after restart with the **old cookies**; WS accepts the cookie; revoked link 410, live 200; no duplicate `no-gps-24h`; `tick()` raises 0; next request id = max + 1; notification ids unique |
| F22-T4 | same | Pass. Only SHA-256 hashes in `sessions`/`reset_tokens`; slide +30 s → no write, +61 s → one write; logout, disable and password reset delete rows; expired row purged at start; old cookie still valid after restart; used reset token still 410 after restart |
| F22-T5 | same | Pass. Reset → 204, socket closed 4401, old cookie 401, clock offset 0; roles, users, invites, fleets (+counts), drivers page, requests, share links, dashboards equal a fresh server; route absent with `dev: false` (404) |
| F22-T6 | folded into T3 | Pass. Seed assignment ended + driver reassigned twice: `vehicleOf`/`driverOf`, driver and vehicle histories equal after restart; episodes rebuilt (tick = 0); request seq resumes |
| F22-T7 | `tests/f22-budgets.perf.test.ts` | Pass (numbers below) |
| F22-T8 | regression | `pnpm check`: typecheck clean, lint 0 errors (8 pre-existing warnings), vitest 1104/1106 — the 2 failures are F11-T3 (time-of-day flake, also fails on the pre-F22 tree, verified) and F09-T3 tray budget under load (passes when re-run alone). `pnpm build` clean. e2e: see below |

## Budgets (spec §8, 1 lakh vehicles, dev machine, load avg 4–6)

| Measure | Budget | Measured |
|---|---|---|
| Start on `:memory:` (F11-T8 gate ≤ 1500 ms) | ≤ +200 ms | 196 ms vs 190 ms pre-F22 (+6 ms) |
| Start on an empty file DB (migrate + seed + hydrate + first tick) | ≤ +200 ms | 169–208 ms |
| Start on the full-DB fixture (504 users, 500 invites, 1k sessions, 505 fleets, 10k moves, 5.2k driver patches, 20k assignments, 2k requests / 7k events, 20k notifications / 11.5k reads, 1k share links) | ≤ +250 ms | 208–239 ms (≈ +20–50 ms) |
| Read requests | 0 SQL | 0 statements over 9 GETs (counted on `StatementSync.prototype`) |
| Single mutation p95 | ≤ 2 ms added | invite 0.06, role edit 0.01, assign 0.07, request create + 3 acts 0.23, share create 0.04 ms |
| Move 1,000 vehicles | ≤ 30 ms added | 5.9 ms for the whole request |
| Dev reset | ≤ 1 s | 40 ms (full DB), 6–8 ms (2000 vehicles) |

Asserted: both file starts ≤ 3 s and reset ≤ 2 s (×2 margins), plus the existing F11-T8 gate.

## e2e (setup + chromium + clock, ports 5273/4101, `MOCK_DB=:memory:`)

- Full run: 82 passed, 1 failed (F12-T5), 17 skipped; the clock project did not run because of
  that failure (it depends on chromium). A second full run: 81 passed, F12-T5 and F10-T5 failed.
- Re-runs show these are environmental. **Other agents (F23–F26) were editing `mock-server/**`
  and `src/**` in the same checkout during the runs.** `tsx watch` restarts the mock on those
  edits, and an in-memory database loses every session. The trace shows a `502 Bad Gateway`
  in the middle of a test, followed by the sign-in page.
- F12-T5 (driver search): a server check at 1 lakh vehicles (`/api/vehicles?driver=` and
  `/vehicles/:id/driver` for 5 new drivers) returns the right vehicle every time. The remaining
  failure is in the worker's driver index: a prefix is marked "filled" before the vehicle is in
  the snapshot. That code is unchanged by F22.
- Clock: `F15-T4` and `F05-T8` pass when run after `setup` without the `+7 days` auth clock test
  (3/3). In the full clock run, F15-T4 fails: this is the known order-dependent flake, because the
  `+7 days` jump expires the shared super-admin session.

## Deviations from the spec

- `seedDatabase(db, { config, drivers, now })` builds its own seeded `FleetTree`, so reset never
  depends on the runtime tree. `hydrateStores`, `prepareStores` and `resetStores` also live in `seed.ts`.
- `tree.recordMove(vehicleId, fleetIdx)` takes the vehicle **id**, which is the row key.
- Hydrate keeps seeded fleet slots (`nodes.length ≥ 205`), so a deleted seeded fleet's id is never
  reused. A runtime fleet deleted at the end of the index can be reused after a restart, because
  no high-water mark is stored.
- `rsa` and `replacement` columns also carry `CHECK (json_valid)`.
- F22-T6 is folded into the T3 restart test. The harness has no separate restart helper:
  `startServer({ dbPath })` is simply called twice. The T7 fixture builder lives in the perf test.
- `POST /drivers` with an invite stays non-atomic, as before: if the invite fails, the driver is
  still created and persisted. Keeping it non-atomic avoids memory and DB getting out of sync.
- F19 migration test now opens with `MIGRATIONS.slice(0, 2)` (it asserts v2).
