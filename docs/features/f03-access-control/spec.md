# F03 — Access Control (fleet tree, users, invites, roles, permissions) · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-14 (user)** |
| Intent | `intent.md` (signed off 2026-10-13; admin screens in scope, D-016) |
| Visual source of truth | DS1 tokens + Doto. Admin screens are new surfaces; §4 proposes their look, and UAT screenshots confirm it (as for F02). |
| Server contract | Built in F01: `/api/fleets`, `/api/vehicles`, `/api/fleets/:id/vehicles`, `/api/users`, `/api/invites`, `/api/roles`, `/api/permissions` (`shared/contract/access.ts`, `permissions.ts`). One mock change: R14. |
| Delivery | **Two agents in parallel** from one shared contract commit (§5):<br>• **F03a** Fleets: tree + vehicle moves. Branch `feature/f03a-fleets`, D-080…D-082.<br>• **F03b** People: users, invites, roles, permission gating. Branch `feature/f03b-people`, D-083…D-085. |

## 1. Files (kebab-case)
```
src/features/access/
  api/access-api.ts             (contract commit) typed calls on api-client for every access endpoint
  permissions/can.ts            (contract commit) can(me, permission), useCan(permission), <RequirePermission>
  components/admin-layout.tsx   (contract commit) page header + content area used by every admin page
  components/no-access-page.tsx (contract commit)
  components/admin-overview-page.tsx  /admin: cards with counts + links (F03b)
  fleets/fleet-tree-store.ts    (F03a) class store: tree, expand/select, optimistic rename/move, errors
  fleets/fleets-page.tsx        (F03a) tree + selected-fleet panel
  fleets/fleet-tree.tsx         (F03a) virtualised tree rows (TanStack Virtual, already a dependency)
  fleets/fleet-vehicles.tsx     (F03a) paginated vehicle list of the selected fleet, multi-select, move
  fleets/fleet-picker.tsx       (F03a, shared) searchable tree picker; also used by F03b invite/user forms
  people/users-page.tsx         (F03b)
  people/invites-page.tsx       (F03b) list + invite dialog
  people/roles-page.tsx         (F03b) list + role editor
src/app/router.tsx, nav-items.ts  permission guards on admin routes; nav filtered by permission
```
No new dependencies.

## 2. Requirements

### Permissions everywhere (F03b)
| ID | Requirement |
|---|---|
| F03-R1 | `can(me, p)` is the one check. It reads `me.permissions` from the F02 `SessionStore`.<br>• `useCan(p)` for components. `<RequirePermission p>` wraps routes and shows the **No access** page ("You don't have access to this page." + link to the first page you can open).<br>• Hidden, not disabled, for actions you never have; disabled with a tooltip only where the reason is temporary. |
| F03-R2 | **Gating matrix** (each must be shown by a test):<br>• `live.view`: `/live-tracking`. Without it the default landing is the first allowed admin page, or No access.<br>• `vehicle.details.view`: clicking a vehicle opens the details card.<br>• `vehicle.parameters.view`: the Parameters tab.<br>• `table.view`: the table button, `?view=table`.<br>• `table.export`: Export CSV (already F09-R10; now via `can`).<br>• `share.create` / `share.revoke`: reserved for F10 (`can` ready).<br>• `users.manage`: Users page; `users.invite`: Invites page + Invite button; `fleets.manage`: Fleets page; `roles.manage`: Roles page.<br>• `/admin` and the Admin nav group show only when at least one admin permission is held; each nav item only with its permission. |
| F03-R3 | Live tracking keeps reading permissions from `me` (existing `hasPermission` in the live store is re-pointed to `can`, so there is one source). |

### Fleets (F03a)
| ID | Requirement |
|---|---|
| F03-R4 | **Fleet tree page** (`/admin/fleets`, `fleets.manage`):<br>• Tree of the fleets in your scope (`GET /api/fleets`), up to 5 levels, with subtree vehicle counts.<br>• Expand/collapse, search by name (matches plus their ancestors stay visible), keyboard navigation (tree ARIA pattern).<br>• Virtualised rows, so a few thousand fleets stay smooth. |
| F03-R5 | **Create / rename / move / delete:**<br>• "Add child fleet" on a node (disabled at depth 5 with the reason).<br>• Inline rename (Enter saves, Esc cancels).<br>• Move: choose a new parent in the fleet picker; the picker hides the node's own subtree and parents that would exceed 5 levels.<br>• Delete only for an empty leaf; otherwise the menu says why ("Still has vehicles" / "Still has child fleets"). Root can't be moved or deleted.<br>• Server errors (409/422) show as a toast with the server message and the tree reverts. |
| F03-R6 | **Vehicles of a fleet:** the selected fleet's panel lists its **direct** vehicles (`GET /api/vehicles?fleetId=`, cursor pages of 100, infinite scroll), with search (regno, VIN, device ID). Multi-select (checkbox, shift-range, select page) → "Move to fleet…" → picker → `POST /api/fleets/:id/vehicles`. Shows "Moved N vehicles", and counts refresh. |
| F03-R7 | **Fleet picker** (shared): searchable tree, single or multi select, used for move targets (F03a) and for invite/user fleet scopes (F03b). Selecting a node implies its subtree (shown as checked + dimmed children). |

### People (F03b)
| ID | Requirement |
|---|---|
| F03-R8 | **Users** (`/admin/users`, `users.manage`): table of name, email, role, fleet scope (names, "+N"), status. Search + filter by role/status. Row → side panel to change role, fleet scope (picker) and status (Active / Disabled, with a confirm for Disable: "They will be signed out now"). You can't change your own role or status (controls disabled with the reason). |
| F03-R9 | **Invites** (`/admin/invites`, `users.invite`): list with email, role, fleets, invited by, sent / expires (IST, relative), status pill (pending / accepted / revoked / expired). Filter by status (default: pending).<br>• **Invite user** dialog: email, role, fleet scope (picker, ≥ 1). 409 messages ("user already exists", "pending invite exists") show on the email field.<br>• Row actions: **Resend** (pending or expired; resets expiry), **Revoke** (pending; confirm). |
| F03-R10 | **Roles** (`/admin/roles`, `roles.manage`): list of roles with permission count and number of users. Role editor: name + grouped permission checkboxes (Live · Vehicle · Table · Share · Admin) using `PERMISSION_LABELS`.<br>• System roles (Super Admin) are read-only.<br>• Delete is blocked while users or pending invites use the role (server 409 shown).<br>• **`users.invite` and `roles.manage` can't be granted to custom roles** (B8: only Super Admin invites) — shown locked with the reason (R14 enforces it on the server). |
| F03-R11 | **Admin overview** (`/admin`): cards for Fleets (count), Users (active / disabled), Pending invites, Roles — each only if you hold its permission, linking to its page. |
| F03-R12 | **Changes to the signed-in user's own access** apply on their next sign-in or reload (the server enforces at once; disabling ends their sessions, which F02 turns into a redirect to `/login`). |

### Scope (both)
| ID | Requirement |
|---|---|
| F03-R13 | A user scoped to a sub-fleet sees only that subtree's vehicles on the map, table and CSV, and only that subtree in the filter panel and fleet picker. (Enforced by the server/WS; F03 adds the e2e proof.) |
| F03-R14 | **Mock change (only one):** `POST/PATCH /api/roles` reject `users.invite` and `roles.manage` for non-system roles with 422 + a field message. Contract test added. |

## 3. Budgets
- Fleets page: tree of all seeded fleets renders and expands with no long task > 50 ms; vehicle list pages load in ≤ 300 ms from the mock.
- Admin pages don't render the map. The live-tracking worker keeps running with the session (F02-R4, unchanged), so returning to the map is instant.

## 4. Look (proposal)
- Same shell (rail + 56 px top bar). Admin pages use a content column on `--bg`, max 1200 px, 24 px padding (16 px on mobile).
- Lists are glass tables like F09 (Doto, uppercase muted headers, 40 px rows, `--accent-soft` selection). Side panels and dialogs reuse the F07 card style (`surface-solid`, 420 px panel; bottom sheet on mobile).
- Status pills reuse the status-pill component with admin variants (active / disabled / pending / accepted / revoked / expired).
- Fleet tree rows: chevron, name, depth guides, vehicle count on the right, a row menu (⋯).

## 5. Parallel delivery (shared contract commit, on `main` before the agents start)
`access-api.ts` (typed calls + query keys), `can.ts` (+ tests), `admin-layout.tsx`, `no-access-page.tsx`, route guards wired with `<RequirePermission>` around placeholder pages, nav filtered by permission, and an **interface-only** `FleetPicker` props type with a minimal placeholder implementation (F03a replaces it). F03b uses the placeholder until F03a merges; both merge on `integration/f03`.

## 6. Tests
| ID | Agent | Type | Test |
|---|---|---|---|
| F03-T1 | contract | unit | `can`, `useCan`, `<RequirePermission>`; nav filtered per permission set. |
| F03-T2 | F03a | unit/component | `fleet-tree-store`: build tree from flat list, search keeps ancestors, depth-5 rule, move excludes own subtree, optimistic revert on error. Picker subtree implication. |
| F03-T3 | F03a | e2e | Create child → rename → move under another parent → delete leaf; depth-5 add disabled; delete of non-empty shows reason. Move 3 vehicles to another fleet → counts update; the moved vehicles show the new fleet in the table (F09). |
| F03-T4 | F03b | component | Users panel (own role/status locked), invite dialog validation + 409 on email, resend/revoke, role editor (system read-only, locked permissions, delete blocked). |
| F03-T5 | F03b | e2e | Invite with a custom role + sub-fleet → accept (F02) → the new user sees only allowed nav items and pages; direct URL to a forbidden page shows No access. Disable that user while signed in → their next request lands on `/login`. |
| F03-T6 | F03b | e2e | **Gating matrix:** a custom role without each of `vehicle.parameters.view`, `table.view`, `table.export`, `live.view` shows the matching control/page hidden (R2). |
| F03-T7 | F03b | e2e | **Scope:** `ops@fms.local` (North) — vehicle total, table total and CSV row count equal North's subtree count from `/api/fleets`; the filter panel and picker list only North's subtree. |
| F03-T8 | F03b | unit | Mock: roles reject `users.invite` / `roles.manage` for custom roles (R14). |
| F03-T9 | both | e2e | UAT screenshots → `docs/features/f03-access-control/screenshots/`: admin overview, fleets tree + vehicles, move dialog, users + panel, invites + dialog, roles + editor, No access, mobile fleets and users. |
| F03-T10 | both | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock). Perf run by the orchestrator after merge. |

## 7. Out of scope
Audit log UI, bulk CSV user import (intent), deleting users (disable instead), transferring super admin, per-vehicle (non-fleet) access, and live push of permission changes to an open session (R12).
