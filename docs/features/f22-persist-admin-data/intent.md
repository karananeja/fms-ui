# F22 — Persist Accounts & Admin Data in SQLite · Intent

**Status:** Signed off: 2026-10-15 (user: "yes", with sessions that survive a restart)

## Why
Only dashboards (F18) survive a mock-server restart. Invited users, role edits, fleet changes, driver assignments, requests, notifications and share links are lost, and dashboards of runtime users are orphaned.

## What
- Move these stores to the F18 SQLite database (`mock-server/data/fms.db`, D-112/D-119), each behind its **current interface**, so routes and the browser don't change:
  - accounts: users, password hashes, roles and permissions, invites, reset tokens;
  - **sessions**, so you stay signed in after a restart;
  - the fleet tree (and vehicle → fleet moves);
  - drivers and assignments;
  - requests (breakdown, replacement, RSA) and their history;
  - notifications;
  - share links.
- **First start on an empty database:** it is filled from today's deterministic seed (`MOCK_SEED`), so seed accounts and data look exactly as before.
- **Unchanged:** vehicles and live telemetry stay simulated in memory (the generator and WS), because they are not account data.
- **Tests and e2e:** keep using `:memory:`, so runs stay isolated and repeatable. The dev reset endpoint re-seeds the database.
- **Schema:** new tables come in new numbered migrations; past ones are never edited.

## Out of scope
A real backend or ORM, multi-process or concurrent servers, data migrations from old in-memory runs (nothing to migrate), and persisting telemetry or trails.

## Done when
- The existing server tests and e2e pass unchanged on `:memory:`.
- A restart test (file database) keeps a new invited user, a role edit, a fleet move, a driver assignment, a request with history, a notification, a share link and a signed-in session.
- A runtime user's dashboard is still visible to them after a restart.
- Server start on an empty database (seed) and on a full database stays within a budget set in the spec.
