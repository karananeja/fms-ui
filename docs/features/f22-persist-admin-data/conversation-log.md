# F22 — Persist Accounts & Admin Data in SQLite · Conversation log

## 2026-10-15 — Implementation (one agent, branch `feature/f22-persist-admin-data`)

**User (via orchestrator):** "Implement F22 … spec.md (signed off; §13 overrides) … server-only change … make sure an
existing F18-era fms.db (migrations 1–2, dashboards only, no seed_state) upgrades cleanly on first start."

**Assistant:** Implemented the spec as write-through caches (D-136…D-140):

- `mock-server/db/migrations.ts`: v3 `accounts`, v4 `fleets`, v5 `drivers`, v6 `requests`,
  v7 `notifications_and_shares` (append-only; v1–v2 untouched).
- `mock-server/db/database.ts`: re-entrant `atomic()` (depth counter per connection; also nests
  inside an open F18 `transaction()`).
- `mock-server/db/seed.ts` (new): `SEED_VERSION = 1`, `seedDatabase`, `wipeDatabase`,
  `checkSeedState`, plus `hydrateStores` / `prepareStores` (start) / `resetStores` (dev reset).
  An F18-era file (no `seed_state`) is seeded **without** wiping its dashboards; only
  `MOCK_DB_RESET=1` and `POST /api/dev/reset` wipe.
- Stores: `accounts` (SHA-256 session/invite/reset token hashes, slide written ≥ 60 s,
  `updateUser`/`updateRole`/`deleteRole`/`rename`, invite `driverIdx`), `drivers` (patches,
  created, ended seed assignments, assignment log; `hydrate` replays), `requests` (`save` = upsert
  row + new timeline events; `fleet_settings`), `notifications` (rows, reads, read-all; episodes
  rebuilt from `no-gps-24h` rows), `share-links` (raw tokens). Each has `hydrate()`.
- `fleet-tree.ts`: `attach(db)`, write-through create/update (re-parent writes the subtree)/remove,
  `recordMove`, `hydrate(sim)`; `vehicle-sim.ts`: seeded placement copy, `restoreSeedPlacement()`,
  `moveTo(i, f, record = true)`.
- `build-server.ts`: DB opened first; stores built; `prepareStores` (seed / verify / hydrate);
  the invite→driver link listener moved here (`invites.driver_idx`); `linkSeedDriver` moved
  into seeding. `live-hub.ts`: `closeAll`, `clearMoved`. Routes: `access-routes` use the new
  store methods and wrap the vehicle move batch in one `atomic`; `driver-routes` dropped the
  `invited` map; `dev-routes` + `POST /reset` (204).
- `config.ts`: `dbReset` (`MOCK_DB_RESET=1`). README and `.env.example` document `MOCK_DB`,
  `MOCK_DB_RESET`, `/api/dev/reset` and "delete fms.db to start over".
- Tests: F22-T1 in `database.test.ts`; T2–T6 in `tests/f22-persistence.test.ts`; T7 in
  `tests/f22-budgets.perf.test.ts`. F18/F19 migration tests pinned to their versions.

Mid-task instruction from the orchestrator (user was being prompted): stop using heredoc/python
shell edits; use Read/Edit/Write only and single simple Bash commands. Followed from then on.

**Status/Next:** Implemented and tested (see `test-report.md`). Ready for UAT. The user must
restart `pnpm dev` once; the first start migrates `mock-server/data/fms.db` to v7 and seeds it
(dashboards kept).
