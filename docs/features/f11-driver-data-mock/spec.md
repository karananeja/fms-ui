# F11 — Driver Data & Mock Contract · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-14 (user)** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Builds on | F01 contract style (zod in `shared/contract/`, Fastify mock, D-005 worker untouched), F03 permissions/`can()`, D-038 mock clock |
| Delivery | One agent in the main checkout (no worktrees), branch `feature/f11-driver-data`, ports 5273/4101, decisions **D-092…D-094**. No UI in this feature. |

## 1. Files (kebab-case)
```
shared/contract/drivers.ts          Driver, Assignment, FleetSettings schemas
shared/contract/requests.ts         DriverRequest (breakdown | replacement | rsa), actions, timeline, BreakdownReason
shared/contract/notifications.ts    Notification, NotificationKind, read state
shared/contract/no-gps-insight.ts   NoGpsInsight, LikelyCause
shared/contract/analytics.ts        query params, VehicleKpis, DriverKpis, series, rankings
shared/contract/permissions.ts      + drivers.manage, requests.manage, analytics.view, chat.use, driver.self
shared/contract/ws.ts               + topic 'events', + scope { kind: 'self' }
mock-server/generator/driver-sim.ts      deterministic drivers + initial assignments (pure functions of seed/index)
mock-server/generator/history-sim.ts     closed-form daily aggregates per vehicle (IST days)
mock-server/store/drivers.ts             overlay of driver/assignment mutations on top of driver-sim
mock-server/store/requests.ts            requests, timelines, replacement engine
mock-server/store/notifications.ts       notifications + per-user read state, 24 h no-GPS job
mock-server/routes/driver-routes.ts, request-routes.ts, notification-routes.ts, analytics-routes.ts
mock-server/live/live-hub.ts             + 'events' topic fan-out
mock-server/store/accounts.ts            + Driver system role, seed driver account, permissions on existing roles
```
Tests sit next to each file (`*.test.ts`) plus `mock-server/tests/*-contract.test.ts`.

## 2. Domain
| Entity | Fields (all ids strings, times epoch ms) |
|---|---|
| **Driver** | `id, userId \| null, name, phone, fleetId, status: active \| off-duty \| disabled, createdAt` |
| **Assignment** | `id, driverId, vehicleId, from, to \| null, by` (userId or `system`). One open assignment per driver and per vehicle. |
| **FleetSettings** | `fleetId, autoAssignReplacement: boolean` (default false; inherited down the fleet tree unless overridden) |
| **DriverRequest** | `id, type, vehicleId, driverId, fleetId, status, reason?, note, location \| null, createdAt, updatedAt, timeline[{at, status, by, note?}]`, plus `replacement?: {suggestedVehicleId?, assignedVehicleId?}` and `rsa?: {assignee, etaMinutes}` |
| **BreakdownReason** | `no-gps-device, battery-charging, tyre, accident, mechanical, other` |
| **Notification** | `id, kind, severity: info \| warning \| critical, title, body, fleetId, vehicleId?, requestId?, createdAt`, plus per-user `readAt` |
| **NoGpsInsight** | `vehicleId, since, durationMs, reportedReason?, signals{devBatteryLow, weakSignal, ignitionOff, deviceOffline}, likelyCause, explanation` |

**Request status flows** (invalid transitions → 409):
- breakdown: `open → acknowledged → resolved | closed`
- rsa: `open → acknowledged → dispatched → resolved | closed`
- replacement: `open → suggested → approved → assigned`; `open → waiting` (no vehicle qualifies) `→ suggested`; any open state `→ rejected | closed`. With `autoAssignReplacement`, `open → assigned` happens at once when a vehicle qualifies.

**Replacement suggestion:** an idle vehicle in the same fleet:
- not assigned to a driver and with no open request;
- status `stopped` or `charging`;
- SOC ≥ 40 % (EV) and range ≥ 60 km;
- ranked by distance to the request location (or the broken vehicle's last fix).

On `assigned`, the driver's assignment moves to the new vehicle (history kept).

**Likely no-GPS cause:** derived from F05 thresholds and the latest payload. Priority order (first match wins):
1. the driver's reported reason (an open breakdown with `no-gps-device`);
2. `deviceOffline` (non-comm);
3. `devBatteryLow` (`devbattery` < 3.4 V);
4. `weakSignal` (`rxdbm` < −105);
5. `ignitionOff` (parked, e.g. indoors);
6. `unknown`.

`explanation` is one plain sentence.

## 3. REST (`/api`, cookie session, fleet-scoped like F03)
| Method + path | Permission | Notes |
|---|---|---|
| `GET /drivers?q&fleetId&status&cursor&limit` · `POST /drivers` · `GET/PATCH /drivers/:id` | `drivers.manage` | `q` matches name/phone. POST can `invite: true` → F03 invite with role Driver, links `userId` on accept |
| `PUT /drivers/:id/assignment {vehicleId}` · `DELETE /drivers/:id/assignment` | `drivers.manage` | 409 if the vehicle has another open assignment |
| `GET /assignments?vehicleId\|driverId` | `drivers.manage` or `vehicle.details.view` | history, newest first |
| `GET /vehicles/:id/driver` | `vehicle.details.view` | current driver or `null` |
| `GET /vehicles?driver=<q>` | `live.view` | extends F03 search by driver name |
| `GET /driver/me` | `driver.self` | me, my vehicle (meta + latest combinfo subset), my open requests |
| `POST /requests {type, reason?, note, location?}` | `driver.self` | for my current vehicle; 409 if the same type is already open |
| `GET /requests?type&status&fleetId&cursor` · `GET /requests/:id` | `requests.manage` (any in scope) or `driver.self` (own only) | |
| `POST /requests/:id/actions {action, note?, vehicleId?, assignee?, etaMinutes?}` | `requests.manage` | `acknowledge, dispatch, resolve, close, approve, override, reject` |
| `GET /requests/:id/suggestions` | `requests.manage` | top 5 candidates with distance, SOC, range |
| `GET/PATCH /fleets/:id/settings` | `fleets.manage` (PATCH), `requests.manage` (GET) | |
| `GET /vehicles/:id/no-gps-insight` | `vehicle.details.view` | 404 if the vehicle isn't in no-GPS |
| `GET /notifications?unread&cursor&limit` · `POST /notifications/read {ids? \| all: true}` | signed in | only notifications the user may see (below) |
| `GET /analytics/summary\|vehicles\|drivers\|series?from&to&fleetId&vehicleId&driverId&sort&limit` | `analytics.view` | IST day buckets, `to − from` ≤ 90 days |

**Notification visibility:**
- `no-gps-24h` goes to users holding `live.view` whose scope contains the vehicle.
- `request-*` and `replacement-waiting` go to users holding `requests.manage` in scope, and to the requesting driver for their own request's updates.

## 4. WebSocket
- **New topic `events`:** `subscribe {topic:'events', scope:{kind:'fleet', fleetIds}}` for staff, or `{kind:'self'}` for drivers.
- **Server message:** `{type:'event', id, kind: 'notification' | 'request' | 'assignment', data}`, with `data` validated by its schema. The server filters by the same visibility rules as REST.
- **Unchanged:** `combinfo`/`lafparsed` and the worker path. `events` is consumed on the main thread (low volume) by F13–F15.

## 5. Generators and jobs
- **Drivers (`driver-sim`):** about 0.85 × vehicles, created deterministically from the seed. Names come from an Indian name catalogue and phones are `+91 9xxxx xxxxx`. Initially only `normal`-persona vehicles have an assigned driver. Mutations live in the store overlay, so no 85k objects are allocated up front.
- **History (`history-sim`):** closed-form daily aggregates per vehicle and IST day for the last 90 days, from the sim's duty cycle, speed and SOC parameters. No per-sample stepping. The fields are:
  - distance, drive / idle / uptime / downtime;
  - no-GPS time, energy used (kWh), charge sessions, breakdowns;
  - harsh brake / harsh accel / overspeed counts (persona-weighted noise).

  Driver KPIs are vehicle-days weighted by assignment history. The driver score is 100 minus weighted events per 100 km, clamped to 0–100.
- **No-GPS age:** change the `noGps` persona age from "11 min–3 h" to a spread where **about 30 % are older than 24 h** (24 h–5 d). The persona share is unchanged, so F05/F06 counts don't move.
- **No-GPS signal causes:** each no-GPS vehicle gets a seeded signal cause (low device battery, weak signal, ignition off, none), so insights vary.
- **24 h job:** every mock-clock minute, a vehicle crossing 24 h of no-GPS raises **one** `no-gps-24h` notification per episode. The job is clock-aware (D-038), so `POST /dev/clock` past the threshold fires it.

## 6. Accounts and permissions
- `PERMISSIONS` gains `drivers.manage, requests.manage, analytics.view, chat.use, driver.self`. `ADMIN_PERMISSIONS` gains `drivers.manage` (F03 Admin group).
- **Super Admin:** all. **Operator:** adds `requests.manage, analytics.view, chat.use`. **Viewer:** unchanged.
- **New system role Driver:** `[driver.self]` only.
- **Seed:** `driver@fms.local` / `Drive@1234`, a driver in North with an assigned normal vehicle (added to `docs/03-dev-accounts.md`).
- A Driver user's WS may only subscribe `events` with `{kind:'self'}`. Any `combinfo`/`lafparsed` subscribe → `forbidden`.

## 7. Budgets (mock, dev machine)
| Query | Budget |
|---|---|
| `GET /analytics/summary` for the root fleet (1 lakh vehicles), 30 days | ≤ 500 ms; 90 days ≤ 1.2 s |
| one fleet (≤ 5 k vehicles), 90 days | ≤ 100 ms |
| `GET /requests/:id/suggestions` | ≤ 50 ms |
| 24 h job tick at 1 lakh | ≤ 20 ms |
| Mock start-up time increase | ≤ 300 ms |

## 8. Tests
| ID | Type | Test |
|---|---|---|
| F11-T1 | unit | `driver-sim` / `history-sim` are deterministic for a seed. KPIs are internally consistent (drive + idle + downtime = 24 h per day; distance ≈ drive × speed). |
| F11-T2 | unit | Request state machines: every valid transition, invalid → 409, timeline appended, no second open request of the same type. |
| F11-T3 | unit | Replacement: candidate filter and ranking; `waiting` when none qualify, then `suggested` when one becomes eligible; auto-assign moves the assignment and keeps history. |
| F11-T4 | unit | No-GPS insight priority order for each cause, including the driver-reported case. |
| F11-T5 | contract | Every new endpoint validates against its zod schema; fleet-scope and permission denials (403/404) for out-of-scope users; the Driver role sees only its own data. |
| F11-T6 | contract | WS `events`: staff receive in-scope events only; a driver receives own-request events only; a driver can't subscribe `combinfo`. |
| F11-T7 | contract (clock) | `/dev/clock` past 24 h of no-GPS → exactly one `no-gps-24h` per vehicle-episode, visible only to in-scope `live.view` users. |
| F11-T8 | perf (node) | §7 budgets at 1 lakh. |
| F11-T9 | cmd | `pnpm check`, `pnpm build`, and e2e (setup + chromium + clock) stay green. F05/F06 counts are unchanged. |

## 9. Decisions to propose
- **D-092:** drivers and initial assignments are generated deterministically, with a mutation overlay (no up-front allocation).
- **D-093:** a new WS topic `events` with a `self` scope for drivers; consumed on the main thread, not the worker.
- **D-094:** analytics come from closed-form daily aggregates in IST days, limited to 90 days. The no-GPS persona age is widened so that about 30 % exceed 24 h.

## 10. Out of scope
UI of any kind (F12–F17). Persisting across mock restarts. Real telematics events (harsh driving is simulated).
