# F14 — Operator Request Desk & No-GPS Insight · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server contract | F11: `/api/requests*` (list, get, actions, suggestions), `/api/fleets/:id/settings`, `/api/vehicles/:id/no-gps-insight`, WS `events` (`kind:'request'`). **No mock changes.** |
| Visual source of truth | DS1 tokens + Doto. The desk reuses the F03/F09 table + F07 card patterns. No new look. |
| Delivery | One agent in the main checkout, branch `feature/f14-request-desk`, ports 5373/4200, decisions **D-101…D-102**. Runs in parallel with F13. |

## 1. Files (kebab-case)
```
src/features/requests/api/requests-api.ts
src/features/requests/request-desk-store.ts            class-based main-thread store: list, filters, live merge via events-socket (F15)
src/features/requests/pages/request-desk-page.tsx      /requests (+ /requests/$requestId opens the drawer)
src/features/requests/components/request-table.tsx
src/features/requests/components/request-drawer.tsx    details, timeline, actions
src/features/requests/components/replacement-panel.tsx suggestions, approve / override / reject
src/features/requests/components/rsa-dispatch-form.tsx assignee + ETA
src/features/requests/components/fleet-auto-assign-toggle.tsx
src/features/live-tracking/components/no-gps-insight.tsx   F07 card section when status = no-gps
src/app/router.tsx, nav-items.ts                       /requests route + "Requests" nav item (requests.manage) with open-count badge
```

## 2. Requirements
| ID | Requirement |
|---|---|
| F14-R1 | **Desk** (`/requests`, `requests.manage`): a table of requests in scope, newest first. **Columns:** type icon, vehicle regno (links to the map), driver, reason, status pill, age, last update. **Filters:** type, status (default: open states), fleet; search by regno/driver. The open-count badge on the nav item updates live. New or updated rows highlight briefly when an `events` update arrives. |
| F14-R2 | **Drawer** (`/requests/$requestId`): the request details, the driver (name, phone), the location on a small static map snippet (reuses the MapLibre style from F06, lazy), and the timeline. **Actions per state machine (F11 §2):** acknowledge, dispatch RSA (assignee + ETA minutes), resolve, close, reject, each with an optional note. Invalid actions are hidden. A 409 means the request changed meanwhile, so the drawer refreshes. |
| F14-R3 | **Replacement panel:** for replacement requests (and a "Suggest replacement" shortcut on breakdown requests) it shows the top 5 candidates: regno, distance, SOC, range, status. **Approve** assigns the top suggestion. **Override** lets the operator pick another candidate or search a vehicle in the fleet (eligibility is checked by the server; a reason shows when one isn't eligible). **Waiting** shows "No eligible vehicle yet. We'll notify you." |
| F14-R4 | **Auto-assign setting:** a per-fleet toggle "Assign replacements automatically", visible with `fleets.manage` on the desk header for the selected fleet and in the F03 fleet detail. It shows whether the value is inherited from a parent fleet. Auto-assigned requests show "Assigned automatically" in the timeline. |
| F14-R5 | **No-GPS insight:** when a vehicle's status is `no-gps`, the F07 card shows a **Why no GPS?** section: the likely cause (icon + one sentence from F11 `explanation`), "since" (relative + IST), the signals as chips (Device battery 3.2 V · Signal −110 dBm · Ignition off · Device offline), and the driver-reported reason with a link to the request when there is one. It's fetched when the card opens and on `events` for that vehicle. |
| F14-R6 | Permissions: `requests.manage` for the desk and actions; `fleets.manage` for the toggle; `vehicle.details.view` for the insight section. |

## 3. Budgets
- The desk shows first rows within 1 s; the live update of a row within 2 s of the event.
- Opening the drawer has no long task > 50 ms (the map snippet loads lazily after first paint).

## 4. Tests
| ID | Type | Test |
|---|---|---|
| F14-T1 | unit | `request-desk-store`: filter, live merge (insert/update/remove from the filtered set), open-count. |
| F14-T2 | component | The drawer shows only valid actions per state. RSA dispatch form validation. Replacement panel states: suggested / waiting / override. |
| F14-T3 | e2e (two contexts) | The driver reports a breakdown (F11 API as the seed driver) → it appears on the desk within 5 s → acknowledge → the replacement is suggested → approve → the request is `assigned` and the driver's assignment shows the new vehicle (API check). |
| F14-T4 | e2e | RSA: dispatch with assignee + ETA → resolve; the timeline shows all steps. Override with an ineligible vehicle shows the server reason. |
| F14-T5 | e2e | Auto-assign on for a fleet → a new replacement request becomes `assigned` without operator action, and the timeline says so. |
| F14-T6 | e2e | No-GPS insight: a signal-derived no-GPS vehicle shows its cause chips; a vehicle with an open `no-gps-device` breakdown shows the driver-reported reason and a link. |
| F14-T7 | e2e | UAT screenshots → `screenshots/`: desk, drawer (breakdown, RSA, replacement), auto-assign toggle, no-GPS insight section (desktop + mobile). |
| F14-T8 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. |

## 5. Decisions to propose
- **D-101:** the request desk uses a main-thread class store live-merged from the shared `events-socket`, with the drawer routed at `/requests/$requestId`.
- **D-102:** the no-GPS insight section in the F07 card; the auto-assign toggle shown with inheritance.

## 6. Out of scope
External RSA providers, SLA timers/escalations, bulk actions, editing a request's type.
