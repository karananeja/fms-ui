# F12 — Drivers & Assignment · Intent

**Status:** Draft (awaiting user sign-off)

## Why
Operators need to know which driver is assigned to which vehicle and to change it.

## What
- **Drivers admin page** (`/admin/drivers`, `drivers.manage`): list, search, status (active / off duty / disabled), and invite a driver (reuses the F03 invite flow, role Driver).
- **Assign / unassign** a vehicle to a driver: from the driver row and from the vehicle details card. One active vehicle per driver and one active driver per vehicle. History is kept.
- **Driver on the map:** the F07 details card shows the assigned driver (name, phone, since when). Search (F08) can find a vehicle by driver name.

## Out of scope
Driver shifts and rosters; licence or document management.

## Done when
Assigning a driver in the admin page or from the vehicle card updates both views, and e2e covers assign → reassign → history.
