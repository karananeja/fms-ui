# F18 — Test report

Branch `feature/part3-ds3-f18` (main checkout, shared with DS3). No UI in this feature. Run 2026-10-15 on Node v24.14.0.

## Runs
| Command | Result |
|---|---|
| F18 targeted (`shared/contract/dashboards.test.ts`, `mock-server/db/database.test.ts`, `mock-server/tests/f18-dashboards.test.ts`) | **17/17** |
| `pnpm lint` | clean |
| `pnpm typecheck` (`tsc -b`) | F18 files clean. At the time of the final run the only errors were in DS3's in-progress `src/shared/theme/theme-boot.test.ts` (node types in the app tsconfig), not F18 |
| `vitest run` (whole suite) | **952/953**; the 1 failure is the known time-of-day F11-T3 replacement-engine test (`mock-server/store/requests.test.ts`, untouched) |
| `pnpm build` | pass; `node:sqlite` / `DatabaseSync` absent from every file in `dist/` |
| Mock smoke (`MOCK_PORT=4201 MOCK_DB=/tmp/… pnpm mock:once`) | starts (2000 vehicles, ready in 73 ms), creates the DB file + WAL, no ExperimentalWarning |
| e2e setup + chromium | **not run by this agent** (DS3 owns `e2e/` and adds `MOCK_DB=':memory:'` to the Playwright webServer env); orchestrator to run once both land |

## Acceptance tests
| ID | Result | Notes |
|---|---|---|
| F18-T1 | pass | all 8 types (9 samples incl. both `kpi` sources) parse; rejects `iframe`, extra `html` key, `score` on vehicle ranking, `limit` 51, `range: '2d'`, daily chart `today`, 2001-char text, 61-char widget title, bad id, 25 widgets, 81-char/blank title, empty patch; layout `x+w>cols` (lg/md/sm), duplicate `i`, dangling `i`, `w<minW`, `h>24`, unknown key; `widgets.0.type` path for unknown types |
| F18-T2 | pass | fresh `:memory:` → 5 tables; re-running `migrate` keeps the same `schema_migrations` rows; DB stamped v99 → `Database schema v99 is newer than this server (v1)`; FK cascade; FK and `json_valid` CHECKs enforced |
| F18-T3 | pass | create 201 v1 with lg/md/sm normalised (lg packs 3×2 kpi + 6×5 ranking in one row; sm all `w=1`); list/get; patch title+widgets+layout → v2 (removed widget's item gone, new widget appended); duplicate → "(copy)", v1, empty thread; delete 204 → 404. Also: explicit layout with a dangling `i` → 422; Operator adding `driver-list` (needs `drivers.manage`) → 422 `widget_not_permitted` |
| F18-T4 | pass | two patches on v1 → 200, then 409 `version_conflict` `{currentVersion: 2}`; stored title is the first |
| F18-T5 | pass | Super Admin: 50 owned (24 widgets each) OK, 51st and a duplicate → 409 `dashboard_limit`; one shared-with-me doesn't count |
| F18-T6 | pass | candidates for ops include superadmin, exclude self, viewer and a disabled Operator; `q` filters (case-insensitive); only `{userId,name,email}`; share is idempotent; superadmin sees it in `sharedWithMe` as `viewer` (shareCount 0; owner sees 1); all 7 owner-only routes → 403 for the viewer; duplicate → 201 owned by superadmin; revoke → 404; non-shared user → 404 on get and patch; non-candidate / self → 422 with `details` |
| F18-T7 | pass | custom role (`dashboards.use` + `analytics.view`) on a North child fleet: opens ops' shared dashboard; `/api/analytics/summary` `vehicleCount` = vehicles in their subtree (< ops'); `/api/analytics/vehicles` items all in their subtree; sibling `fleetId` → 403 for them, 200 for ops |
| F18-T8 | pass | `iframe` / `text`+`html` on POST and PATCH → 422 `validation_failed` with paths, nothing stored, version unchanged; viewer → 403 on all 12 routes; signed out → 401 on all 12 |
| F18-T9 | pass | `appendMessage` seq 1, 2 …; `applyTurn` → v+1, one change set (`undoable`); stale version → `version_conflict`; invalid draft → 422 and rolled back; `undo` restores title/widgets/layout as v+1 and sets `undoneAt`; second undo, older change set, and undo after a manual PATCH → 409 `not_undoable`; stale undo version → `version_conflict`; REST undo works; 205 extra messages → 200 kept (seq 8…207); delete removes messages + change sets |
| F18-T10 | pass | temp-file DB: create + patch (v2) + share + thread message → close → new server on the same file → identical dashboard (v2), share and thread |
| F18-T11 | partial | check (lint + vitest) + build as above; e2e left to the orchestrator |

## Budgets (§9, reported, not gated)
| Measure | Result | Budget |
|---|---|---|
| `GET /api/dashboards` (50 owned × 24 widgets + 1 shared) | p95 **0.51 ms** (n=40) | ≤ 20 ms |
| `GET /api/dashboards/:id` (24 widgets) | p95 **0.34 ms** | ≤ 20 ms |
| `PATCH /api/dashboards/:id` (24 widgets + layout) | p95 **0.78 ms** | ≤ 20 ms |
| `POST /api/dashboards` (mostly 24 widgets) | p95 **1.68 ms** (n=58) | ≤ 20 ms |
| Open + migrate | `:memory:` well under the test's 200 ms guard; whole server restart on a file DB (200 vehicles, incl. open + migrate) **9.8 ms** | ≤ 50 ms |

## Deviations / notes
- `schema_migrations` is created by `openDatabase` (`CREATE TABLE IF NOT EXISTS`), not inside migration 1, so the runner can read the applied version before applying anything. Migration 1 otherwise matches §2.
- Store constructor also takes the `FleetTree` (`new Dashboards(db, clock, accounts, tree)`): needed for the fleet-overlap rule of share candidates.
- `MOCK_DB` defaults to `:memory:` whenever `VITEST` is set (not only in the harness), because several existing tests call `buildServer()` directly and would otherwise write `mock-server/data/fms.db`.
- `widget_not_permitted` is checked for widgets that are new **or changed** on an owner write (unchanged widgets pass, so an owner who lost a permission can still rename). Duplicate is an owner write, so duplicating a dashboard with widgets the caller can't read → 422.
- An explicit `layout` in a POST/PATCH must only reference the resulting widgets (422 otherwise); items for removed widgets are dropped only from the *stored* layout (PATCH with `widgets` but no `layout`, and F19 turns).
- `addShares` 422 `details` are `[{userId, reason: 'self' | 'not_a_candidate'}]`. `undo` of an unknown change id → 404.
- `src/` edits (minimal): `src/features/access/people/permission-groups.ts` (Insights group + `dashboards.use`) and `src/features/access/people/people-pages.test.tsx` (Operator permission count `2 / 16` → `2 / 17`).
