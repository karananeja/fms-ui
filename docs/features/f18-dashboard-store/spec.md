# F18 — Dashboard Store & Contract · Spec

**Status:** Signed off: 2026-10-15 (user)

| Field | Value |
|---|---|
| Intent | `intent.md` (signed off 2026-10-15) |
| Builds on | F01 contract style (zod in `shared/contract/`, `{error:{code,message,details?}}` envelope), F03 `authorize()` + fleet scope, F11/F16 analytics endpoints, F17 assistant (D-105…D-107). Accepted: **D-112** (`node:sqlite`), **D-113** (react-grid-layout, client), **D-116** (fixed widget catalogue, data as the viewer, view-only sharing, `dashboards.use`). |
| Serves | F19 (thread storage, tool chips, per-turn change sets + undo, owner-only mutations) and F20 (list/get/patch with `version`, react-grid-layout layouts per breakpoint, duplicate, share/revoke). |
| New dependencies | None. `node:sqlite` is built into Node ≥ 24 (`engines.node >=24`; verified on v24.14.0: `DatabaseSync`, `json_extract`, `json_valid` work). |
| Delivery | One agent in the main checkout (no worktrees), shared branch `feature/part3-ds3-f18` (alongside DS3, disjoint files), ports 5373/4201, decisions **D-119…D-121**. No UI in this feature (F20). Can run in parallel with DS3 (disjoint files). |

## 1. Files (kebab-case)
```
shared/contract/dashboards.ts            limits, widget catalogue (discriminated union), layout, dashboard, share, thread, change schemas
shared/contract/dashboards.test.ts       catalogue/layout validation unit tests
shared/contract/permissions.ts           + 'dashboards.use' ("Use dashboards")
shared/contract/index.ts                 + export * from './dashboards.ts'
mock-server/db/database.ts               openDatabase(path): DatabaseSync, pragmas, runs migrations
mock-server/db/migrations.ts             ordered, append-only migration list (version, name, sql)
mock-server/db/database.test.ts          migration idempotency / unknown-future-version guard
mock-server/store/dashboards.ts          Dashboards store (CRUD, shares, thread, change sets, undo, normalise layout)
mock-server/routes/dashboard-routes.ts   REST in §5
mock-server/config.ts                    + dbPath (env MOCK_DB, default mock-server/data/fms.db)
mock-server/context.ts                   + db, dashboards on MockContext
mock-server/build-server.ts              open DB, construct store, register routes, close DB onClose
mock-server/store/accounts.ts            Operator role + 'dashboards.use'
mock-server/testing/harness.ts           startServer() defaults dbPath ':memory:'
mock-server/tests/f18-dashboards.test.ts contract/integration tests (§8)
src/features/access/people/permission-groups.ts  'dashboards.use' in the Insights group (role editor)
playwright.config.ts                     (owned by DS3, which adds MOCK_DB=':memory:' to the webServer env)
.gitignore                               + mock-server/data/
```

## 2. Database (`node:sqlite`, D-112)
- **Location:** `config.dbPath` from `MOCK_DB`; default `mock-server/data/fms.db` (directory created on start, git-ignored). `:memory:` in vitest (harness default) and e2e (playwright env). A test may pass a temp-file path to prove persistence.
- **Open:** `new DatabaseSync(path)`; `PRAGMA foreign_keys = ON`, `journal_mode = WAL` (file only), `busy_timeout = 2000`, `synchronous = NORMAL`. One connection per server; closed in `onClose`. All access is synchronous (it's a mock: small rows, sub-ms queries); multi-statement writes go in `BEGIN IMMEDIATE … COMMIT`.
- **Migrations:** `migrations.ts` exports `[{version, name, sql}]`, append-only (never edit a shipped one). On open: create `schema_migrations` if missing, apply every version > max applied in its own transaction, record it. If the DB has a version newer than the code knows → throw `Database schema v{n} is newer than this server (v{m})`, so the server refuses to start rather than corrupt data. Re-running on an up-to-date DB is a no-op.
- **Timestamps** come from `ctx.clock.now()` (D-038 dev clock), epoch ms.

### Migration 1 `dashboards`
```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);

CREATE TABLE dashboards (
  id          TEXT PRIMARY KEY,                 -- 'dash-' + randomUUID()
  owner_id    TEXT NOT NULL,                    -- Accounts user id (seed ids are stable across restarts)
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  widgets     TEXT NOT NULL CHECK (json_valid(widgets)),   -- Widget[] (validated by zod before write)
  layout      TEXT NOT NULL CHECK (json_valid(layout)),    -- DashboardLayout
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX dashboards_owner ON dashboards (owner_id, updated_at DESC);

CREATE TABLE dashboard_shares (
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  shared_by    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (dashboard_id, user_id)
);
CREATE INDEX dashboard_shares_user ON dashboard_shares (user_id);

CREATE TABLE dashboard_messages (
  id           TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,                -- 1, 2, … per dashboard
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text         TEXT NOT NULL,
  chips        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(chips)),  -- ToolChip[]
  change_id    TEXT,                            -- assistant turn that changed the dashboard
  created_at   INTEGER NOT NULL,
  UNIQUE (dashboard_id, seq)
);

CREATE TABLE dashboard_changes (
  id             TEXT PRIMARY KEY,
  dashboard_id   TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  summary        TEXT NOT NULL,                 -- "Added 3 widgets, renamed dashboard"
  before         TEXT NOT NULL CHECK (json_valid(before)),  -- {title, description, widgets, layout}
  before_version INTEGER NOT NULL,
  after_version  INTEGER NOT NULL,
  undone_at      INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX dashboard_changes_dash ON dashboard_changes (dashboard_id, created_at DESC);
```
- Deleting a dashboard cascades to shares, messages and change sets (intent: "deleting a dashboard deletes its thread").
- **Retention:** a thread keeps its latest 200 messages and a dashboard its latest 20 change sets; older rows are pruned on append (only the latest change set is undoable anyway, §6).

## 3. Contract (`shared/contract/dashboards.ts`)

### 3.1 Limits (exported constants)
| Constant | Value |
|---|---|
| `DASHBOARDS_PER_USER` | 50 (owned; shared-with-me don't count) |
| `WIDGETS_PER_DASHBOARD` | 24 |
| `DASHBOARD_TITLE_MAX` / `DASHBOARD_DESCRIPTION_MAX` | 80 / 500 (title trimmed, ≥ 1) |
| `WIDGET_TITLE_MAX` | 60 |
| `TEXT_NOTE_MAX` | 2000 (F17 in-house markdown subset; never HTML) |
| `LIST_LIMIT_MAX` | 50 rows (ranking / vehicle list / driver list / request list) |
| `SHARES_PER_DASHBOARD` | 50 |
| `THREAD_MESSAGES_MAX` / `MESSAGE_TEXT_MAX` | 200 / 8000 |

### 3.2 Common pieces
- `widgetId`: `/^w-[a-z0-9-]{1,36}$/`, unique within a dashboard (server assigns `w-` + short random on create when absent).
- `timeRange`: `z.enum(['today','yesterday','7d','30d','90d'])`, relative only; the client resolves it in IST to `from`/`to` (`to` = now, ≤ `ANALYTICS_MAX_DAYS`). Relative ranges keep a dashboard current when reopened.
- `scope`: `{ fleetId?: string }`. It's a **narrowing** filter only, applied as the viewer: if the fleet is outside the viewer's scope, the API returns 403 and the widget shows "Outside your fleets"; with no `fleetId` the widget covers the viewer's whole scope.
- `kpiMetric`: any `KPI_FIELDS` member plus the summary-only `uptimePct`, `eventsPer100Km`, `score`, `vehicleCount`.
- Each widget = `{ id, type, title, …settings }`; `z.discriminatedUnion('type', […])` with `.strict()` objects, so unknown types and unknown keys are rejected.

### 3.3 Widget catalogue (data always fetched by the client as the viewer)
| `type` | Settings | Data source (existing) | Needs |
|---|---|---|---|
| `kpi` | `source: 'analytics'` → `{metric: kpiMetric, range, fleetId?, vehicleId?, driverId?}` · or `source: 'live'` → `{status: VehicleStatus \| 'total', fleetId?}` (nested discriminated union on `source`) | analytics: `GET /api/analytics/summary?from&to&fleetId&vehicleId&driverId` · live: worker `statusCounts` (`LivePush`) | `analytics.view` / `live.view` |
| `daily-chart` | `{chart: 'bar'\|'line'\|'area', metrics: KpiField[1..3], range (≥ 7d), fleetId?, vehicleId?, driverId?}` | `GET /api/analytics/series` (IST day points; F16 `day-chart.tsx`) | `analytics.view` |
| `status-breakdown` | `{display: 'bars'\|'donut', statuses?: VehicleStatus[], fleetId?}` | worker per-status counts (`VEHICLE_STATUSES`, F05) | `live.view` |
| `ranking` | `{entity: 'vehicles'\|'drivers', metric: KpiField \| 'score' (drivers only), order: 'desc'\|'asc', limit: 1..50, range, fleetId?}` | `GET /api/analytics/vehicles` or `/api/analytics/drivers` with `sort=<metric>[:asc]&limit` (F16 `ranking-table.tsx`) | `analytics.view` |
| `vehicle-list` | `{filter: {statuses?, fleetIds?, assetTypes?, fuelTypes?, makes?, socMin?, socMax?}, columns: VehicleListColumn[1..8], sort: {column, dir}, limit: 1..50}` with `VehicleListColumn` ∈ `regno, fleet, status, speed, soc, dte, odometer, gpstime, location` (ids of F09 `TABLE_COLUMNS`) | live worker (same `VehicleFilter` semantics as F08; F20 adds a read-only worker query that doesn't touch the map/table filter) | `live.view` |
| `driver-list` | `{status?: DriverStatus, fleetId?, q?: string(≤ 40), limit: 1..50}` | `GET /api/drivers?status&fleetId&q&limit` | `drivers.manage` |
| `requests-summary` | `{groupBy: 'status'\|'type', types?: RequestType[], openOnly: boolean, fleetId?, display: 'counts'\|'latest', limit: 1..50}` | `GET /api/requests?type&fleetId&limit=500` (newest first), grouped on the client; "500+" shown when `nextCursor` is set | `requests.manage` |
| `text` | `{body: string(1..2000)}` (markdown subset) | none | — |

- `WIDGET_TYPES`, per-type `WIDGET_PERMISSIONS` (above) and `WIDGET_SIZES` (default `w×h` and `minW/minH` on the lg grid, e.g. `kpi` 3×2 min 2×2, `daily-chart` 6×4 min 4×3, `ranking`/lists 6×5 min 4×4, `text` 4×2 min 2×1) are exported, so F19's tool descriptions and F20's renderer share one source.
- **Permissions at save time (proposed, Q3):** an owner write that adds a widget whose `WIDGET_PERMISSIONS` the owner lacks → 422 `widget_not_permitted` (`details: [{widgetId, permission}]`). Viewers may lack them; F20 then renders a "You don't have access to this data" state for that widget.

### 3.4 Layout (react-grid-layout, D-113)
```ts
DASHBOARD_BREAKPOINTS = { lg: { minWidth: 1200, cols: 12 }, md: { minWidth: 768, cols: 6 }, sm: { minWidth: 0, cols: 1 } }
layoutItem   = z.object({ i: widgetId, x: int ≥ 0, y: int ≥ 0, w: int ≥ 1, h: int 1..24, minW?: int, minH?: int }).strict()
dashboardLayout = z.object({ lg: layoutItem[], md: layoutItem[], sm: layoutItem[] }).strict()
```
- Valid when, per breakpoint: `x + w ≤ cols`, `i` values unique and each references a widget, `w ≥ minW`, `h ≥ minH`. Overlaps are allowed (react-grid-layout compacts vertically on the client).
- **Server normalisation** (on every write): items for removed widgets are dropped; a widget without an item gets one appended at the bottom with its `WIDGET_SIZES` default (clamped to `cols`; `sm` always `w = 1`). So F19 tools can add widgets without computing layouts, and the stored layout always covers every widget at every breakpoint.

### 3.5 Resources
```ts
dashboardAccess = z.enum(['owner', 'viewer'])
dashboard = { id, ownerId, ownerName, title, description, widgets: Widget[], layout, version: int ≥ 1,
              createdAt, updatedAt, access: dashboardAccess }
dashboardSummary = { id, ownerId, ownerName, title, description, widgetCount, version, updatedAt,
                     access, shareCount /* 0 for viewers */ }
dashboardList = { mine: dashboardSummary[], sharedWithMe: dashboardSummary[] }   // each sorted updatedAt desc
createDashboardBody = { title?: string (default "Untitled dashboard"), description?, widgets?: Widget[] (≤ 24), layout? }
updateDashboardBody = { version: int, title?, description?, widgets?, layout? } (≥ 1 field besides version;
                      widgets/layout replace the whole value)
duplicateDashboardBody = { title?: string }   // default "<title> (copy)", truncated to 80
dashboardShare = { userId, name, email, sharedAt }
shareCandidate = { userId, name, email }
addSharesBody = { userIds: string[1..20] }
toolChip = { tool: string, label: string (≤ 120), status: 'ok' | 'error' }
threadMessage = { id, seq, role: 'user' | 'assistant', text, chips: toolChip[], change: changeSet | null, createdAt }
changeSet = { id, summary, beforeVersion, afterVersion, undoneAt: epochMs | null, undoable: boolean }
dashboardThread = { messages: threadMessage[] }     // oldest first, ≤ 200
undoBody = { version: int }
```

## 4. Access rules
- Every endpoint requires `dashboards.use` (`authorize(ctx, req, 'dashboards.use')`) → 401/403 as usual.
- **Visibility:** a dashboard is visible to its owner and to users in `dashboard_shares`. Anyone else gets **404 `not_found`** (existence is never leaked, like F17's out-of-scope = not found).
- **Owner-only:** patch, delete, shares (list/add/revoke), thread read, undo. A viewer gets **403 `forbidden`** ("Only the owner can change this dashboard") because they already know it exists. Viewers may get and duplicate.
- **Share candidates** ("users the owner can see"): Operators can't call `GET /api/users` (`users.manage`), so a dedicated read returns users who are `active`, ≠ caller, hold `dashboards.use`, and whose fleet scope **overlaps** the caller's (one user's granted fleet is in the other's subtree; Super Admin's root overlaps everyone). Only `{userId, name, email}` is returned. Adding a share for a non-candidate → 422 `validation_failed` (`details: [{userId, reason}]`).
- **Data scope** is enforced by the existing endpoints, not the store: the store never resolves widget data, so a shared dashboard renders only the viewer's fleets (D-116).
- Users who lose `dashboards.use`, are disabled, or no longer exist after a restart (non-seed users are in memory): their rows stay; lists/shares omit unknown users; `ownerName` falls back to "Former user".

## 5. REST (`/api`, cookie session)
| Method & path | Who | Body / query | Success | Errors |
|---|---|---|---|---|
| `GET /dashboards` | any | — | 200 `dashboardList` | — |
| `POST /dashboards` | any | `createDashboardBody` | 201 `dashboard` (v1) | 422 validation; 409 `dashboard_limit` (50 owned) |
| `GET /dashboards/:id` | owner, viewer | — | 200 `dashboard` | 404 |
| `PATCH /dashboards/:id` | owner | `updateDashboardBody` | 200 `dashboard` (version + 1) | 404; 403; 422; **409 `version_conflict`** `details: {currentVersion}` |
| `POST /dashboards/:id/duplicate` | owner, viewer | `duplicateDashboardBody` | 201 `dashboard` owned by the caller (v1; widgets + layout copied, new widget ids not needed; thread, changes and shares **not** copied) | 404; 409 `dashboard_limit` |
| `DELETE /dashboards/:id` | owner | — | 204 (cascade) | 404; 403 |
| `GET /dashboards/share-candidates?q=` | any | `q` ≤ 40, name/email contains; ≤ 50 | 200 `shareCandidate[]` | — |
| `GET /dashboards/:id/shares` | owner | — | 200 `dashboardShare[]` | 404; 403 |
| `POST /dashboards/:id/shares` | owner | `addSharesBody` (idempotent per user) | 200 `dashboardShare[]` (full list) | 404; 403; 422 non-candidate/self; 409 `share_limit` |
| `DELETE /dashboards/:id/shares/:userId` | owner | — | 204 (also when not shared) | 404; 403 |
| `GET /dashboards/:id/thread` | owner | — | 200 `dashboardThread` | 404; 403 |
| `POST /dashboards/:id/changes/:changeId/undo` | owner | `undoBody` | 200 `dashboard` (version + 1) | 404; 403; 409 `version_conflict`; 409 `not_undoable` |

- Sharing, revoking and deleting don't change `version` (only content edits do). `updatedAt` changes on every content edit.
- Error codes are the existing envelope: `unauthenticated`, `forbidden`, `not_found`, `validation_failed` (zod issues in `details`, so an unknown widget type points at `widgets.N.type`), 422 `widget_not_permitted` (§3.3), the 409 codes above, `internal`.
- **No client write to the thread in F18.** F19 adds the per-dashboard chat route (SSE, owner only), which calls the store in-process.

## 6. Store API (`mock-server/store/dashboards.ts`, used by routes and by F19 tools)
```ts
class Dashboards {
  constructor(db: DatabaseSync, clock: Clock, accounts: Accounts)
  list(userId): DashboardList
  get(userId, id): Dashboard                       // 404 unless owner/shared
  create(ownerId, body): Dashboard                 // limit, normalise, v1
  update(ownerId, id, body): Dashboard             // owner check, version check, normalise, v+1
  duplicate(userId, id, title?): Dashboard
  remove(ownerId, id): void
  shares(ownerId, id) / addShares(ownerId, id, userIds) / revokeShare(ownerId, id, userId)
  shareCandidates(user, q?): ShareCandidate[]
  thread(ownerId, id): DashboardThread
  // F19 (server-side only):
  appendMessage(ownerId, id, msg: {role, text, chips, changeId?}): ThreadMessage
  applyTurn(ownerId, id, expectedVersion, summary, mutate: (draft) => void): {dashboard, change}
  undo(ownerId, id, changeId, expectedVersion): Dashboard
}
```
- `applyTurn` runs in one transaction: snapshot `before`, apply the mutation to a draft, validate the whole dashboard with the contract schema, normalise, write `version + 1`, insert the change set. A turn with several tool calls makes **one** change set (F19 groups them, so undo is "one step per turn").
- **Undo** (intent: no history beyond the last change): allowed only for the dashboard's most recent change set, not yet undone, and only while `dashboard.version === afterVersion` (any later manual edit, e.g. an F20 layout drag, makes it `not_undoable`). Undo restores `before` as a new version (`version + 1`) and sets `undoneAt`; `changeSet.undoable` in the thread reflects this.
- Every write validates with the same zod schemas the routes use, so F19 tools can't store anything outside the catalogue ("the AI never sends code").

## 7. Accounts and permissions
- `PERMISSIONS` gains `dashboards.use`, label "Use dashboards". Super Admin gets it automatically (`[...PERMISSIONS]`); the seeded **Operator** role (the only other role with `chat.use`) gets it; Viewer and Driver don't. Custom roles can be granted it in the role editor (Insights group); it's not system-only.
- Seed accounts for tests: `ops@fms.local` (North) owns; `superadmin@fms.local` (root) is a candidate for ops and vice versa; `viewer@fms.local` (Delhi Hub 1) lacks `dashboards.use` (403). The "fewer fleets" scope test uses a custom role with `dashboards.use` + `analytics.view` assigned to a user scoped to a North sub-fleet (created in the test via `/api/roles` + `/api/users/:id`).

## 8. Tests
| ID | Type | Test |
|---|---|---|
| F18-T1 | unit (contract) | Every widget type parses with valid settings; unknown `type`, unknown keys, `metric: 'score'` on vehicle rankings, > 24 widgets, over-long title/text, `limit` > 50 and bad `timeRange` are rejected; layout rules (`x + w ≤ cols`, unique `i`, `i` references a widget). |
| F18-T2 | unit (db) | Migrations on a fresh `:memory:` DB create all tables; running them again is a no-op (same `schema_migrations` rows); a DB stamped with a future version throws; foreign-key cascade removes shares/messages/changes. |
| F18-T3 | contract | CRUD as `ops`: create (201, v1, layout normalised for lg/md/sm), list `mine`, get, patch title/widgets/layout (v2), duplicate (new id, v1, "(copy)", no thread), delete (204, then 404). Every response validates against its schema (harness). |
| F18-T4 | contract | Concurrency: two patches based on v1 → first 200, second **409 `version_conflict`** with `currentVersion: 2`; nothing overwritten. |
| F18-T5 | contract | Limit: the 51st owned dashboard → 409 `dashboard_limit`; dashboards shared with the user don't count. |
| F18-T6 | contract | Sharing: ops → share-candidates include superadmin, exclude self, viewer (no `dashboards.use`) and disabled users; add share → superadmin sees it under `sharedWithMe` with `access: 'viewer'`; superadmin's patch/delete/shares/thread/undo → 403; duplicate → 201 owned by superadmin; revoke → superadmin's get → 404; a non-shared user's get → 404; sharing to a non-candidate → 422. |
| F18-T7 | contract (scope) | A user with fewer fleets (custom role, North sub-fleet) opens ops' shared dashboard with a `kpi`/`ranking` on the whole scope: calling the widget's documented endpoint as that user returns only their vehicles (`vehicleCount` and ranking `fleetId`s are in their subtree); a widget with `fleetId` = a North sibling fleet → 403 for them, 200 for ops. |
| F18-T8 | contract | Validation: POST/PATCH with `{type: 'iframe'}` or `{type: 'text', html: '…'}` → 422 with the path in `details`; nothing stored. Without `dashboards.use` (viewer) every endpoint → 403; signed out → 401. |
| F18-T9 | unit (store) | Thread + undo: `appendMessage` assigns increasing `seq` and prunes to 200; `applyTurn` writes one change set and v+1; `undo` restores the previous widgets/layout/title as v+1 and marks it undone; undo of an older change set, a second undo, or after a manual patch → 409 `not_undoable`; deleting the dashboard deletes its thread. |
| F18-T10 | integration | Persistence: `startServer({dbPath: <tmp file>})`, create + share + append a thread message, `close()`, start a new server on the same file, log in again → the dashboard, share and thread are unchanged and `version` is kept. Temp file removed in `afterAll`. |
| F18-T11 | cmd | `pnpm check`, `pnpm build` (no `node:sqlite` in the browser bundle), e2e setup + chromium stay green (permission-group / nav tests updated for the new permission). |

## 9. Budgets (mock, dev machine)
- Any dashboard endpoint ≤ 20 ms p95 with 50 dashboards × 24 widgets for one user; server start (open + migrate) adds ≤ 50 ms. Measured in F18-T3/T10, reported, not gated.

## 10. Decisions to propose
- **D-119:** SQLite layout for Part 3: `MOCK_DB` (default `mock-server/data/fms.db`, `:memory:` in vitest and e2e), WAL, foreign keys, append-only numbered migrations with a refuse-to-start guard for newer schemas; JSON columns validated by zod before every write.
- **D-120:** Dashboard contract: fixed widget catalogue (8 types, §3.3) mapped to existing endpoints/worker data, relative time ranges, react-grid-layout lg/md/sm (12/6/1 cols) with server-side layout normalisation, limits (§3.1), optimistic concurrency via `version` (409 `version_conflict`).
- **D-121:** Sharing and threads: visibility = owner + shares (others 404), owner-only writes (viewers 403), share candidates = active `dashboards.use` users with overlapping fleet scope (new `GET /api/dashboards/share-candidates`), per-turn change sets with single-step undo of the latest change only, thread capped at 200 messages, owner-only thread read.

## 11. Risks
- `node:sqlite` still prints an `ExperimentalWarning` on Node 24.14 (API stable enough for a mock). Option: add `--disable-warning=ExperimentalWarning` to the `mock` scripts.
- Users other than the seed accounts live in memory, so after a restart their dashboards/shares are orphaned (kept, hidden). Acceptable for a mock; fixing it means moving accounts to SQLite (out of scope per intent).
- Fleets created at runtime (`fleets.manage`) also vanish on restart; widgets pointing at them show the error state.
- Playwright `reuseExistingServer: true`: if the user's own `pnpm dev` is reused, e2e writes into their `fms.db`. Mitigation: F19/F20 e2e use non-default ports (their own server, `MOCK_DB=:memory:`).
- `requests-summary` uses the paged `/api/requests` (≤ 500 newest) because there is no aggregate endpoint; counts are exact only under 500 matching requests (shown as "500+").
- `vehicle-list` / per-fleet `status-breakdown` need a new read-only worker query (F20); the global map/table filter must not be touched.

## 12. Resolved questions (user, 2026-10-15)
1. **Share candidates:** active `dashboards.use` users whose fleets overlap the owner's (`GET /api/dashboards/share-candidates`).
2. **Breakpoints:** lg 12 / md 6 / sm 1 columns.
3. **Owner-unreadable widgets:** rejected with 422 `widget_not_permitted` on owner writes; viewers without access see a "no access" state.
4. **Undo:** only the latest assistant change, and only if nothing was edited after it.
5. **Limits:** 24 widgets per dashboard, 50 shares per dashboard.

## 13. Out of scope
Public (signed-out) dashboard links, edit sharing, version history and multi-step undo, moving other in-memory stores (accounts, fleets, requests) to SQLite, server-side widget data resolution, any UI (F20) or chat route (F19).
