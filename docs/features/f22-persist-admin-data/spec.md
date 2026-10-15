# F22 — Persist Accounts & Admin Data in SQLite · Spec

**Status:** Signed off: 2026-10-15 (user)

| Field | Value |
|---|---|
| Intent | `intent.md` (signed off 2026-10-15, sessions survive a restart) |
| Builds on | F18 SQLite layer (`mock-server/db/database.ts`, `migrations.ts` v1–v2), **D-112** (`node:sqlite`), **D-119** (`MOCK_DB`, WAL, append-only migrations, refuse newer schema), F03 accounts/fleets, F11 drivers/requests/notifications, F10 share links |
| New dependencies | None (`node:sqlite`, `node:crypto`) |
| HTTP / WS contract | Unchanged, except one new dev-only endpoint `POST /api/dev/reset` (204, no body; §7) |
| Delivery | One agent, branch chosen by the orchestrator, ports `VITE_PORT=5273` / `MOCK_PORT=4101`, decisions **D-136…D-140** |

## 1. Approach: write-through caches
Every store keeps today's in-memory structures as **the read path**, so all reads (scope masks, list filters, `touchSession` on each request, WS fan-out) cost no SQL. Each **mutation** also writes its rows synchronously with cached prepared statements (`DatabaseSync`, D-112) before returning. At start each store **hydrates** its structures from the DB. Public store methods, their return values and object identity (tests that hold a returned `DriverRequest` and watch it change keep working) stay the same.

What becomes a table vs stays derived:

| Store | Persisted (tables) | Derived at hydrate (memory only) |
|---|---|---|
| Accounts | roles, users (salt + scrypt hash), invites, sessions, reset tokens | maps by id; email lookup; **mailbox stays memory-only** (dev aid) |
| FleetTree | every node (seeded and runtime, ~205 rows), vehicle→fleet **moves only** | `byId`, `direct[]` counts, `version`, `seededByDepth` (always from the seeded layout) |
| Drivers | patches to generated drivers, created drivers, ended seed assignments, assignment log | `vehicleDriver`/`driverVehicle` (replayed), `byUser`, `logByDriver`/`logByVehicle`; `DriverSim` stays generated |
| Requests | requests, timeline events, `autoAssignReplacement` overrides | `items`, `byId`, `seq` (= max) |
| Notifications | notifications (with audience), per-item reads, "mark all read" | `episodes` (rebuilt from `no-gps-24h` rows), `noGpsVehicles`, `seq` |
| ShareLinks | links | `links` map |
| Not persisted | vehicles and telemetry (generator), live-hub state (`moved`, sockets), clock offset, F17 assistant reports | — |

### 1.1 Hidden state that must move into stores
Routes currently mutate records directly or keep their own maps. F22 replaces these with store methods (same validation, same HTTP responses):
- `access-routes.ts`: `PATCH /users/:id` → `accounts.updateUser(id, patch)` (also ends sessions on disable); `PATCH /roles/:id` → `accounts.updateRole(id, patch)`; `DELETE /roles/:id` → `accounts.deleteRole(id)`; `POST /roles` already uses `addRole`.
- `driver-routes.ts`: the `invited` map (invite id → driver index) becomes `invites.driver_idx`; `accounts.invite(input, by, { driverIdx })`; the `onInviteAccepted` listener receives `driverIdx`.
- `build-server.ts` `linkSeedDriver` (sets the driver user's name): moves into seeding (§5).
- `POST /fleets/:id/vehicles` keeps calling `sim.moveTo`; `moveTo` already updates `tree.direct`, and now also calls `tree.recordMove(i, fleetIdx)` which upserts the move row. The route body is unchanged.

## 2. Access pattern
- One `DatabaseSync` per server (F18), opened **first** in `buildServer`, passed to each store constructor. Each store prepares its statements once.
- New `atomic(db, fn)` in `database.ts`: re-entrant (depth counter per connection; outermost `BEGIN IMMEDIATE … COMMIT`, rollback on throw). Needed because one mutation crosses stores: `requests.act(approve)` → `drivers.assign` → `onAssignment` → `requests.reevaluate` → `notifications.add`. The existing non-re-entrant `transaction()` stays for migrations.
- Every public mutation runs inside `atomic`: validate first (throws before any change), then mutate memory and write rows. Batch writes (fleet move of N vehicles, boot `tick()` raising thousands of notifications, seeding, reset) are one transaction each.
- WS publishes inside a transaction are not undone on rollback (acceptable; rollback only happens on disk errors).
- JSON columns (`fleet_ids`, `permissions`, `audience`, `location`, `show`, `trail`, …) have `CHECK (json_valid(...))`; values come from zod-parsed request bodies or store-built objects (D-119).

## 3. Schema (append-only migrations, D-119)
All timestamps are epoch ms from `clock.now()`. Insertion order (listing order today) is kept via `rowid` / an `ord` column.

**v3 `accounts`**
```sql
CREATE TABLE seed_state (id INTEGER PRIMARY KEY CHECK (id = 1), seed INTEGER NOT NULL,
  vehicles INTEGER NOT NULL, seed_version INTEGER NOT NULL, seeded_at INTEGER NOT NULL);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL,
  permissions TEXT NOT NULL CHECK (json_valid(permissions)), system INTEGER NOT NULL,
  ord INTEGER NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role_id TEXT NOT NULL, fleet_ids TEXT NOT NULL CHECK (json_valid(fleet_ids)),
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  salt TEXT NOT NULL, hash TEXT NOT NULL, ord INTEGER NOT NULL);
CREATE TABLE invites (id TEXT PRIMARY KEY, email TEXT NOT NULL, role_id TEXT NOT NULL,
  fleet_ids TEXT NOT NULL CHECK (json_valid(fleet_ids)), invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, driver_idx INTEGER, ord INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE reset_tokens (token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
```
`role_id` has no FK: a role may be deleted while only non-pending invites reference it (today's rule).

**v4 `fleets`**
```sql
CREATE TABLE fleets (idx INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, parent_idx INTEGER NOT NULL,
  name TEXT NOT NULL, depth INTEGER NOT NULL, city INTEGER NOT NULL, region INTEGER NOT NULL);
CREATE TABLE vehicle_fleet (vehicle_id TEXT PRIMARY KEY, fleet_idx INTEGER NOT NULL);
```
Deleted fleets delete their row; `idx` gaps become `null` slots, exactly like memory today.

**v5 `drivers`**
```sql
CREATE TABLE driver_patches (driver_idx INTEGER PRIMARY KEY, name TEXT, phone TEXT,
  fleet_idx INTEGER, status TEXT, user_id TEXT);              -- generated drivers, NULL = unchanged
CREATE TABLE drivers_created (driver_idx INTEGER PRIMARY KEY, name TEXT NOT NULL,
  phone TEXT NOT NULL, fleet_idx INTEGER NOT NULL, status TEXT NOT NULL, user_id TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE initial_assignment_ends (driver_idx INTEGER PRIMARY KEY, ended_at INTEGER NOT NULL);
CREATE TABLE assignments (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  driver_idx INTEGER NOT NULL, vehicle_id TEXT NOT NULL, from_at INTEGER NOT NULL,
  to_at INTEGER, by TEXT NOT NULL);
CREATE INDEX assignments_open ON assignments (driver_idx) WHERE to_at IS NULL;
```

**v6 `requests`**
```sql
CREATE TABLE requests (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  vehicle_id TEXT NOT NULL, driver_id TEXT NOT NULL, fleet_id TEXT NOT NULL, status TEXT NOT NULL,
  reason TEXT, note TEXT NOT NULL, location TEXT CHECK (location IS NULL OR json_valid(location)),
  rsa TEXT, replacement TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE request_events (request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  n INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, by TEXT NOT NULL, note TEXT,
  PRIMARY KEY (request_id, n));
CREATE TABLE fleet_settings (fleet_idx INTEGER PRIMARY KEY, auto_assign INTEGER NOT NULL);
```
`saveRequest(r)` = upsert the row + `INSERT OR IGNORE` events with `n ≥` the persisted count.

**v7 `notifications_and_shares`**
```sql
CREATE TABLE notifications (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  severity TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, fleet_id TEXT NOT NULL,
  vehicle_id TEXT, request_id TEXT, created_at INTEGER NOT NULL,
  audience TEXT NOT NULL CHECK (json_valid(audience)));
CREATE TABLE notification_reads (user_id TEXT NOT NULL,
  notification_seq INTEGER NOT NULL REFERENCES notifications(seq) ON DELETE CASCADE,
  read_at INTEGER NOT NULL, PRIMARY KEY (user_id, notification_seq));
CREATE TABLE notification_read_all (user_id TEXT PRIMARY KEY, all_seq INTEGER NOT NULL,
  all_at INTEGER NOT NULL);
CREATE TABLE share_links (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, vehicle_id TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  show TEXT NOT NULL CHECK (json_valid(show)), trail TEXT NOT NULL CHECK (json_valid(trail)),
  revoked_at INTEGER);
```
Share tokens stay **raw**: `GET /share-links` returns `url` with the token to its owner (F10), so it must be recoverable. Dashboards (v1/v2) are unchanged; their `owner_id` now always resolves after a restart.

## 4. Fleet tree and 1 lakh vehicles (recommendation)
Persist **only moves** (`vehicle_fleet`, upsert per moved vehicle; moving back to the seeded fleet keeps the row). Vehicle placement is a pure function of (seed, vehicle count, seeded tree); storing all 1 lakh rows would add ~150–250 ms to seeding and to every start for no gain. Fleet nodes (~205 seeded + runtime) are persisted in full: renames, re-parenting (depth shifts of a subtree) and deletes are simplest as whole rows.

Start order matters, because generation depends on the seeded layout:
1. `new FleetTree()` builds the seeded tree; `new VehicleSim(…, tree)` places vehicles via `seededByDepth`;
2. `new Drivers(…)` builds `DriverSim` from the **unmoved** `sim.fleet` (home fleets and initial assignments);
3. `tree.hydrate(db)` replaces nodes from `fleets` rows (`version++`), then applies `vehicle_fleet` via a silent `sim.moveTo` (no `recordMove`), keeping `direct[]` correct. `VehicleSim` keeps a copy of the seeded placement (`Uint32Array`, 400 KB) for reset (§7). Unknown vehicle ids are skipped with a warning.

## 5. Seeding and existing databases
- `mock-server/db/seed.ts` exports `SEED_VERSION = 1`, `seedDatabase(db, { config, tree, sim, drivers })`, `wipeDatabase(db)`.
- **Empty DB** (no `seed_state` row): in one `transaction`: roles (4) and users (4) exactly as the current `Accounts` constructor (new random salts, scrypt N=1024), all seeded fleet nodes, the seed driver link (`driver_patches.user_id = 'u-driver'` for the first North driver with a vehicle, and that user's name = the driver's name, F11 §6), `seed_state(seed, vehicles, SEED_VERSION, now)`. No requests, share links, sessions. Then hydrate, then the first `notifications.tick()` raises today's no-GPS alerts (written normally). Seed accounts and data therefore look exactly as before.
- **Existing DB**: migrate (D-119 guard for newer schemas), then compare `seed_state` with `MOCK_SEED`, `MOCK_VEHICLES`, `SEED_VERSION`. Match → hydrate, purge expired sessions/reset tokens, `tick()` (only new episodes are raised, because `episodes` is rebuilt from stored `no-gps-24h` rows: key `vehicleIdx:(created_at − 24 h)`). Mismatch → refuse to start: `Database was seeded with seed 42 / 100000 vehicles (v1); this server has … Start with MOCK_DB_RESET=1 to wipe and re-seed, or use another MOCK_DB.`
- **`MOCK_DB_RESET=1`** (new, dev only): wipe + reseed at start.
- `:memory:` (vitest, e2e) always takes the empty-DB path, so tests start from the same seed as today.
- Idempotent: seeding runs only without a marker; a crash mid-seed rolls back and the next start seeds again.

## 6. Sessions, tokens and passwords
- Session ids stay 32 random bytes (base64url) in the `fms_sid` cookie. The DB and the memory map key them by **SHA-256** (no salt needed for 256-bit random tokens), so a copied `fms.db` cannot hijack sessions. Reset and invite tokens are hashed the same way; the dev mailbox (memory only, raw tokens) keeps working for e2e.
- Expiry: 12 h sliding (`SESSION_TTL_MS`), checked against `clock.now()` as today. Memory slides on every request; the row's `expires_at` is written only when it moved by ≥ 60 s, so steady traffic costs ≤ 1 write per session per minute. A restart can lose ≤ 60 s of slide.
- Rows are deleted on logout, password reset, user disable, and lazily when found expired; at start, expired rows are purged.
- Passwords: unchanged scrypt (`salt`, `hash` hex). Only these two columns are stored, never a password.
- Clock offset (`POST /api/dev/clock`) is not persisted; a restart returns to wall time.

## 7. Dev reset — `POST /api/dev/reset` (dev only, 204)
1. `hub.closeAll(WS_CLOSE.unauthenticated, 'reset')`; `clock.offsetMs = 0`; clear mailbox.
2. One `transaction`: `wipeDatabase` (DELETE from every F22 table **and** the dashboard tables; not `schema_migrations`) + `seedDatabase`.
3. Reload memory with the same hydrate path as start: restore `sim.fleet` from the seeded copy and rebuild `direct[]`; `tree`, `accounts`, `drivers` (arrays reset from `DriverSim`), `requests`, `notifications` (episodes cleared), `shares`; clear `hub.moved`; then `notifications.tick()`.
All sessions are gone, so callers sign in again. Not registered when `NODE_ENV=production` (same as `/api/dev/clock`).

## 8. Performance budgets (dev machine, 1 lakh vehicles)
| Measure | Budget |
|---|---|
| `buildServer` on an **empty file DB** (migrate + seed + hydrate + first tick writing ~2–4k no-GPS rows) | ≤ +200 ms over today; F11-T8 gate (≤ 1500 ms on `:memory:`) still passes |
| `buildServer` on a **full DB** (fixture: 500 users, 500 invites, 1k sessions, 300 fleets, 10k vehicle moves, 5k driver patches, 20k assignments, 2k requests × 6 events, 20k notifications + 20k reads, 1k share links) | ≤ +250 ms over today |
| Read requests (incl. `touchSession`) | 0 SQL statements; no measurable change |
| Single mutation (invite, role edit, assign, request act, share create) | ≤ 2 ms p95 added |
| Move of 1,000 vehicles | ≤ 30 ms added (one transaction) |
| Dev reset | ≤ 1 s |
Measured in F22-T8 and reported; only the existing F11-T8 gate and the start budgets are asserted (generous ×2 margin under load, CLAUDE.md).

## 9. Tests
| ID | Kind | What |
|---|---|---|
| F22-T1 | unit (`database.test.ts`) | v3–v7 apply on a fresh DB and on a v2 file with dashboards (rows kept); re-open is a no-op; `atomic` is re-entrant and rolls back the outermost transaction on throw |
| F22-T2 | integration | Seed: empty file DB → `seed_state` row, 4 seed logins work, 205 fleets, driver link + name; second start does not reseed (salts and row counts unchanged); seed/vehicles/`SEED_VERSION` mismatch refuses with the message; `MOCK_DB_RESET=1` reseeds |
| F22-T3 | integration, **restart** (temp file, `startServer({dbPath})` twice, file removed in `afterAll`) | Via HTTP before restart: invite + accept a runtime user (and a driver invite that links on accept); create + edit a custom role; patch a user's fleets; create, rename and re-parent a fleet; move vehicles; create, edit and assign a driver; breakdown request acknowledged (history) and a replacement in `waiting`; fleet `autoAssignReplacement` override; mark notifications read (one by id, then all); create one share link, revoke another; runtime user creates a dashboard. After restart, **with the old cookies, no new login**: `/me` OK for both users; all of the above read back identical (lists in the same order, timelines equal, `vehicleCount`s equal, share `url`s equal, revoked link 410); WS accepts the cookie; the dashboard is listed for its owner; no duplicate `no-gps-24h` rows; new request/notification ids continue (no collision) |
| F22-T4 | integration | Sessions: no raw sid in `sessions` (only hashes); logout, disable and password reset delete rows; expired sessions purged at start; slide writes ≤ 1/min (count statements via clock offset); used reset token stays used after restart |
| F22-T5 | integration | Dev reset: after mutations, `POST /api/dev/reset` → 204; old cookie 401, sockets closed, clock offset 0; users, roles, fleets (+ counts), drivers page, requests, share links, dashboards equal a fresh server's; not registered in production |
| F22-T6 | unit | Hydrate equivalence per store: drivers replay (ended seed assignment + reassignments) rebuilds `vehicleOf`/`driverOf`/histories equal to pre-restart; notification episodes from rows; request `seq` resumes |
| F22-T7 | perf (`f22-budgets.perf.test.ts`) | §8 numbers with the full-DB fixture (built via store methods inside one transaction) |
| F22-T8 | regression | Existing suites unchanged on `:memory:`: `pnpm check` green; e2e `setup` + `chromium` (known F09-T8 flake excepted) and `clock` 4/4 on ports 5273/4101 |

## 10. File plan (kebab-case)
```
mock-server/db/migrations.ts           + v3 accounts, v4 fleets, v5 drivers, v6 requests, v7 notifications_and_shares
mock-server/db/database.ts             + atomic() (re-entrant)
mock-server/db/seed.ts                 new: SEED_VERSION, seedDatabase, wipeDatabase, checkSeedState
mock-server/db/database.test.ts        + F22-T1
mock-server/config.ts                  + dbReset (MOCK_DB_RESET)
mock-server/build-server.ts            open DB first; seed/verify; hydrate order (§4); linkSeedDriver → seed
mock-server/context.ts                 unchanged type surface (db already on ctx)
mock-server/store/accounts.ts          hydrate, hashed tokens, write-through; + updateUser/updateRole/deleteRole, invite driverIdx
mock-server/store/drivers.ts           hydrate (replay), write-through, reset
mock-server/store/requests.ts          hydrate, saveRequest, fleet_settings
mock-server/store/notifications.ts     hydrate, reads, episodes from rows
mock-server/store/share-links.ts       hydrate, write-through
mock-server/generator/fleet-tree.ts    hydrate, persist create/update/remove, recordMove
mock-server/generator/vehicle-sim.ts   moveTo → tree.recordMove; seeded placement copy; restoreSeedPlacement()
mock-server/live/live-hub.ts           + closeAll(), clear moved (reset)
mock-server/routes/access-routes.ts    use new store methods (HTTP unchanged)
mock-server/routes/driver-routes.ts    drop `invited` map (invite driverIdx)
mock-server/routes/dev-routes.ts       + POST /reset
mock-server/testing/harness.ts         + restart helper (same dbPath), fixture builder for T7
mock-server/tests/f22-persistence.test.ts   F22-T2…T6
mock-server/tests/f22-budgets.perf.test.ts  F22-T7
README.md                              MOCK_DB_RESET, /api/dev/reset, "delete mock-server/data/fms.db to start over"
```

## 11. Decisions to propose
- **D-136** — Accounts, sessions, fleet tree (+ vehicle moves), drivers/assignments, requests, notifications and share links are persisted in `fms.db` as **write-through caches**: memory stays the read path, each mutation writes synchronously, stores hydrate at start; migrations v3–v7. Routes that mutated records directly call new store methods; HTTP/WS unchanged. Supersedes the "other stores stay in memory" part of D-112.
- **D-137** — Seed once: `seed_state(seed, vehicles, seed_version)`; empty DB → seed from `MOCK_SEED` in one transaction; mismatch refuses to start; `MOCK_DB_RESET=1` and dev-only `POST /api/dev/reset` wipe (incl. dashboards) + reseed in one transaction.
- **D-138** — Session, reset and invite tokens stored as SHA-256 hashes; 12 h sliding session expiry persisted at most once a minute; passwords stay scrypt; share tokens stay raw (shown back to owners); dev mailbox and clock offset are memory only.
- **D-139** — Vehicle→fleet: persist only moves (`vehicle_fleet`), never the 1 lakh seeded placements; fleet nodes persisted in full.
- **D-140** — Re-entrant `atomic()` around every cross-store mutation; WS publishes inside it are not rolled back.

## 12. Risks
- **Memory/DB divergence** if a write fails after memory changed. Mitigation: validate before mutating; failures are disk errors only; the server logs and returns 500, and a restart reloads the DB truth.
- **Missed write path** (a mutation that skips persistence) is the main bug class. Mitigation: F22-T3 covers every store through HTTP; review checks for direct record mutation (`grep "\.\(roleId\|name\|status\|permissions\) ="` on store records outside stores).
- **Start-up time** with many notifications (unbounded growth across long runs). Mitigation: budgets in §8; reset; retention left as an open question.
- **Generator coupling**: changing the seed generators (fleets, drivers, placement) silently invalidates stored overlays. Mitigation: bump `SEED_VERSION` with any generator change → the server refuses to start and asks for a reset.
- **Reused dev server in e2e** (`reuseExistingServer`) would write into the user's `fms.db` (F18 risk). Mitigation unchanged: e2e on 5273/4101 with `MOCK_DB=:memory:`.
- **Clock e2e**: unaffected (`:memory:`, memory slide exact); a dev who restarts after shifting the clock sees future-dated rows (harmless).
- **F11-T3 replacement flake** remains time-of-day dependent (live sim state, not stored state); boot `tick()` may now advance persisted `waiting` replacements at start (recorded like any other step).

## 13. Resolved questions (user, 2026-10-15)
1. Dev reset also wipes dashboards.
2. A seed or vehicle-count mismatch with an existing DB refuses to start, with a `MOCK_DB_RESET=1` hint.
3. The dev mailbox is not persisted.
4. Small internal route edits are accepted; HTTP stays identical.
5. No cap on stored notifications for now.
6. F17 assistant reports are not persisted (15 min in memory).
