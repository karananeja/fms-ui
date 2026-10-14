# F12 — Drivers & Assignment · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server contract | F11: `/api/drivers*`, `/api/assignments`, `/api/vehicles/:id/driver`, WS `events` (`kind:'assignment'`). **No mock changes.** |
| Visual source of truth | DS1 tokens + Doto; admin pages reuse the F03 `admin-ui.tsx` table/toolbar/dialog patterns; the vehicle card reuses the F07 card style. No new look. |
| Delivery | One agent in the main checkout, branch `feature/f12-drivers`, ports 5273/4101, decisions **D-095…D-096**. Runs in parallel with F15 (separate files, separate ports). |

## 1. Files (kebab-case)
```
src/features/drivers/api/drivers-api.ts            list/get/create/update drivers, assign/unassign, assignment history, vehicle's driver
src/features/drivers/pages/drivers-page.tsx        /admin/drivers
src/features/drivers/components/driver-form.tsx    create/edit (+ "send invite" toggle)
src/features/drivers/components/assign-dialog.tsx  pick a vehicle (regno search) or a driver (name search)
src/features/drivers/components/assignment-history.tsx
src/features/live-tracking/components/driver-section.tsx   F07 overview-tab section
src/features/live-tracking/worker/*                 + 'driver' search field (name prefix) and driver-name index
src/app/router.tsx, nav-items.ts, permissions/can.ts   /admin/drivers route + nav item (drivers.manage)
```

## 2. Requirements
| ID | Requirement |
|---|---|
| F12-R1 | **Drivers page** (`/admin/drivers`, `drivers.manage`). It is a virtualised table, so 85 k rows stay smooth. **Columns:** name, phone, fleet, status pill, current vehicle (regno links to `/live-tracking?vehicle=`), "since", app access (invited / joined / none). **Filters:** status and fleet (fleet picker from F03). **Search:** name/phone, debounced 250 ms, done on the server. It has an "Admin → Drivers" nav item, after Users. The admin overview gets a card with the active drivers count. |
| F12-R2 | **Create / edit driver:** name (required), phone (`+91` format, required), fleet (only in scope), status. **Send app invite** (needs an email) sends the F03 invite with role Driver. Validation errors appear inline, and 409/422 come from the server. |
| F12-R3 | **Assign / reassign / unassign.** Assign from a driver row: search vehicles by regno in the driver's fleet. If the vehicle already has a driver, the dialog warns "MH12… is driven by Ravi K. Reassign?" and confirms. Unassign has its own confirmation. One open assignment per driver and per vehicle, enforced by the server (409 shown inline). |
| F12-R4 | **History:** a driver drawer shows the assignment history (vehicle, from → to, by whom; IST). |
| F12-R5 | **Driver on the vehicle card:** the F07 Overview tab shows a **Driver** section. **Contents:** name, phone (tap to call on mobile), "since 3 d". With `drivers.manage`: **Assign / Change / Unassign** in place. With `vehicle.details.view` only: read-only. No driver: "No driver assigned" (plus Assign with `drivers.manage`). It updates live from WS `events` `assignment` events. |
| F12-R6 | **Search by driver (F08):** the status-bar search gets a **Driver** field. Name prefix, case-insensitive, matched in the worker. The worker loads a compact `vehicleId → driverName` index once (from F11 `GET /api/drivers?fields=compact`, or a dedicated compact endpoint if F11 provides one), and applies `assignment` events forwarded from the main thread. Suggestions show "Driver name · regno". |
| F12-R7 | **Permissions:** everything goes through `can()` / `useCan`. The page, nav item and route are gated by `drivers.manage` (which joins `ADMIN_PERMISSIONS` per F11). |

## 3. Budgets
- Drivers page: first rows within 1 s on the mock for the root scope. Scrolling 85 k rows has no long task > 50 ms (table virtualisation as in F09).
- Driver search: suggestions within 100 ms of the keystroke at 1 lakh vehicles (worker, like F08). Building the driver index takes ≤ 150 ms in the worker.
- The vehicle card's driver section adds no extra long task when opening a vehicle.

## 4. Tests
| ID | Type | Test |
|---|---|---|
| F12-T1 | unit | Worker driver index: build, prefix match, update on assignment event, removed on unassign. |
| F12-T2 | component | Driver form validation; assign dialog conflict warning; driver section states: none / assigned / read-only / manage. |
| F12-T3 | e2e | Super admin: create a driver → assign a vehicle → the vehicle card shows the driver → reassign to another vehicle → history shows both → unassign. |
| F12-T4 | e2e | Two contexts: an assignment change in one appears live on the other's open vehicle card within 5 s. |
| F12-T5 | e2e | Status-bar Driver search finds the vehicle and selecting it opens the card. A Viewer sees the driver read-only and no Drivers nav. |
| F12-T6 | e2e | UAT screenshots → `screenshots/`: the drivers page, the form, the assign dialog with the conflict warning, and the vehicle card driver section (desktop + mobile). |
| F12-T7 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. Perf by the orchestrator. |

## 5. Decisions to propose
- **D-095:** driver-name search lives in the worker as a compact index fed by assignment events, keeping D-005.
- **D-096:** the driver section in F07 Overview, with inline assign for `drivers.manage`.

## 6. Out of scope
Shifts/rosters, licences/documents, bulk import of drivers, driver photos.
