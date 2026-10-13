# F01 — Mock Server & API/WS Contract · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Branch | `feature/f01-mock-server` |
| Code | `shared/contract/*` (zod schemas + types), `mock-server/*` |

## 1. General conventions

- JSON everywhere. All times are **epoch milliseconds (UTC)**.
- Every error response has the shape `{ "error": { "code": string, "message": string } }`.
  - `401` `unauthenticated`
  - `403` `forbidden`
  - `404` `not_found`
  - `409` `conflict`
  - `410` `gone` (expired or revoked token)
  - `422` `validation_failed` (adds `details`: the zod issues)
- **Session:**
  - Cookie `fms_sid`: HttpOnly, SameSite=Lax, Path=/, 12 h sliding expiry.
  - Sessions are kept in memory.
- **Authorisation:**
  - Every endpoint declares the permission it needs.
  - Fleet-scoped data is limited to the user's granted fleet subtrees.
- **Contract source of truth:** every request, response and WS message has a zod schema in `shared/contract/`.
  - Server handlers validate requests with it.
  - Contract tests validate responses against it.
- **Config (env):**

| Variable | Default |
|---|---|
| `MOCK_PORT` | `4000` |
| `MOCK_SEED` | `42` |
| `MOCK_VEHICLES` | `100000` (max `1000000`) |
| `MOCK_VEHICLE_INTERVAL_MS` | `10000` (how often each vehicle reports) |
| `MOCK_BATCH_MS` | `500` (delta flush interval) |
| `MOCK_SNAPSHOT_CHUNK` | `5000` rows |

## 2. Domain model

| Entity | Fields |
|---|---|
| `Fleet` | `id`, `parentId` (null for root), `name`, `depth` (1–5), `vehicleCount` (subtree) |
| `Vehicle` meta | `vehicleId`, `deviceId`, `regno`, `vin` (= `chasiss`), `fleetId`, `assetType`, `fuelType`, `make`, `model`, `variant` |
| `Permission` | one of the 11 strings in F03 intent |
| `Role` | `id`, `name`, `permissions[]`, `system` (super admin = system, not editable) |
| `User` | `id`, `email`, `name`, `roleId`, `fleetIds[]` (granted subtree roots), `status: active \| disabled` |
| `Invite` | `id`, `email`, `roleId`, `fleetIds[]`, `invitedBy`, `createdAt`, `expiresAt` (7 d), `status: pending \| accepted \| revoked \| expired` |
| `ShareLink` | `id`, `token` (32-byte base64url), `vehicleId`, `createdBy`, `createdAt`, `expiresAt`, `show: { drivingEnergy: bool, device: bool }`, `trail: { enabled: bool, windowMinutes: number }`, `revokedAt?` |

## 3. REST endpoints

### Auth (`/api/auth`)
| Method & path | Perm | Body → Response |
|---|---|---|
| `POST /login` | — | `{email,password}` → `200 Me` + sets cookie; `401 invalid_credentials` |
| `POST /logout` | session | → `204`, clears cookie |
| `GET /me` | session | → `Me = {user, role, permissions[], fleetIds[]}` |
| `POST /forgot-password` | — | `{email}` → always `202`. If the email exists, the reset email is stored in the dev mailbox. Token TTL 30 min, single use. |
| `POST /reset-password` | — | `{token,password}` → `204`; `410` expired or used; `422` policy |
| `GET /invites/:token` | — | → `{email, expiresAt}`; `410` |
| `POST /accept-invite` | — | `{token,name,password}` → `200 Me` + cookie; `410`; `422` |

The password policy (D-018) is enforced by a shared zod schema: at least 8 characters, at least 1 letter, at least 1 number.

### Access control
| Method & path | Perm |
|---|---|
| `GET /api/permissions` | session (catalogue) |
| `GET /api/fleets` | session → flat list, scoped to the user's subtrees |
| `POST /api/fleets` `{parentId,name}` · `PATCH /api/fleets/:id` `{name?,parentId?}` · `DELETE /api/fleets/:id` (only if it has no vehicles and no children) | `fleets.manage` (depth must stay ≤ 5, else `422 max_depth`) |
| `GET /api/vehicles?fleetId=&q=&cursor=&limit=` | `fleets.manage` (paginated meta list, used by the admin "move vehicles" screen) |
| `POST /api/fleets/:id/vehicles` `{vehicleIds[]}` | `fleets.manage` (moves the vehicles into this fleet) |
| `GET /api/users` · `PATCH /api/users/:id` `{roleId?,fleetIds?,status?}` | `users.manage` |
| `GET /api/invites` · `POST /api/invites` `{email,roleId,fleetIds}` · `POST /api/invites/:id/resend` · `DELETE /api/invites/:id` | `users.invite` |
| `GET/POST /api/roles` · `PATCH/DELETE /api/roles/:id` | `roles.manage` |

### Share links
| Method & path | Perm |
|---|---|
| `POST /api/share-links` `{vehicleId, expiresAt, show, trail}` → `ShareLink` + `url` | `share.create` + vehicle in scope |
| `GET /api/share-links?vehicleId=` | `share.create` (own links); users with `share.revoke` see all links in scope |
| `DELETE /api/share-links/:id` → revoke (closes live public sockets with `4410`) | `share.revoke`, or the link's creator |
| `GET /api/public/share/:token` → `{vehicle: {regno, make, model, variant, fuelType}, options, expiresAt}` | public; `410` if expired or revoked |
| `GET /api/public/share/:token/trail` → `{points: [[lng,lat,ts],…]}` covering `windowMinutes` | public; `404` if the trail is disabled |

### Dev-only (only when `NODE_ENV !== 'production'`)
- `GET /api/dev/mailbox?to=`: the last emails sent (reset and invite links). Used by e2e tests.
- `POST /api/dev/clock` `{offsetMs}`: shifts the mock clock, to test expiry, non-comm and similar.
- `GET /api/health`.

## 4. WebSocket `/ws/live`

**Authentication:** the session cookie on the upgrade, **or** `?share=<token>` for the public page. Close codes:

| Code | Meaning |
|---|---|
| `4401` | Unauthenticated |
| `4403` | Subscription outside the user's scope |
| `4410` | Share link expired or revoked |

### Client → server
```ts
{ type: 'subscribe', id: string, topic: 'combinfo' | 'lafparsed',
  scope: { kind: 'fleet', fleetIds: string[] } | { kind: 'vehicle', vehicleId: string },
  pids?: string[] }          // lafparsed + fleet scope only: which PIDs to include (from status-rules config)
{ type: 'unsubscribe', id: string }
{ type: 'ping' }
```
Share-token sockets may only subscribe with vehicle scope, and only to their own vehicle. Any other subscription gets `4403`.

### Server → client
```ts
{ type: 'subscribed', id }
{ type: 'snapshot', id, seq, chunk, chunks, fields: string[], rows: unknown[][] }   // columnar, fleet scope
{ type: 'delta',    id, seq, fields: string[], rows: unknown[][] }                  // batched every MOCK_BATCH_MS
{ type: 'payload',  id, topic, data: Combinfo | Lafparsed }                         // vehicle scope, full shape
{ type: 'pong' } | { type: 'heartbeat', ts }                                        // heartbeat every 15 s
{ type: 'error', id?, code, message }
```
- `seq` increases monotonically per subscription.
- After reconnecting, the client re-subscribes and receives a fresh snapshot. There is no resume in the mock.

### Fleet-scope columnar fields
- **`combinfo` snapshot** — every vehicle's metadata plus its live fields:
  - Metadata: `vehicleId, deviceId, regno, vin, fleetId, assetType, fuelType, make, model, variant`.
  - Live fields: `lat, lng, speed, heading, ignstatus, carbattery, devbattery, fixquality, utctime, gpstime, canutctime, soc, dte, odometer, immobilization_status, displayStatus`.
  - `soc`, `dte`, `odometer` and `immobilization_status` come from `parsedcandata`. `displayStatus` is optional; the server may send it (A5).
- **`combinfo` deltas** carry only `vehicleId` and the live fields. The metadata is never repeated.
- **`lafparsed` (fleet scope):** `deviceId, canutctime`, plus one column per requested `pid` (its `pidvalue`).

### Vehicle-scope payloads
`payload.data` matches the sample shapes **exactly**: `combinfo` as in `caninfo.md`, and `lafparsed` with all 374 PIDs as in `lafparsed.md`.
- The first `payload` is sent immediately.
- After that, one is sent each time that vehicle reports.
- For share sockets, the server **removes** any groups the link hides before sending:
  - `drivingEnergy` hidden: removes `speed`, the energy-related `parsedcandata`, and the whole lafparsed topic.
  - `device` hidden: removes `deviceid`, `carbattery`, `devbattery` and `rxdbm`.

## 5. Data generator

- **Deterministic** from `MOCK_SEED`, so test data can be reproduced.
- **Fleet tree:** 5 levels. 1 org → 4 regions (North/South/East/West) → about 20 cities → about 60 hubs → about 120 teams. Vehicles are spread across every level from 2 down.
- **Vehicles:**
  - Templates come from `caninfo.md` and `lafparsed.md`. All vehicles use the sample's `appmeta` and PID set.
  - Variety: make/model/assetType/fuelType come from a small catalogue (e-scooter, e-3W, e-car, ICE truck).
  - Regno follows Indian formats (`KA01AB1234`), and VINs are 17 characters.
- **Movement is a pure function of `(vehicleSeed, t)`.**
  - Each vehicle loops along a seeded closed path around one of about 40 Indian city centres.
  - It follows a duty schedule: drive, stop, charge, and so on.
  - Because position is computed from time, **trail history needs no storage**: `trail` evaluates the function for past timestamps.
- **Status mix at steady state** (approximate, for realistic counters):

| Status | Share |
|---|---|
| running | 35% |
| stopped | 30% |
| charging | 8% |
| non-comm | 8% |
| no-gps | 5% |
| pullout | 5% |
| immobilized | 4% |
| gps-never | 1% |

  The generator produces raw fields only. **It never sets the status directly.** That keeps F05's rules honest.
- **Updates:** each vehicle reports every `MOCK_VEHICLE_INTERVAL_MS`, ±20% jitter. Non-comm vehicles stop reporting. Updates are flushed to subscribers every `MOCK_BATCH_MS`.

## 6. Seed accounts (dev only)

| Email | Password | Role | Fleet scope |
|---|---|---|---|
| `superadmin@fms.local` | `Admin@123` | Super Admin (all perms) | root |
| `ops@fms.local` | `Ops@1234` | Operator (live/details/params/table/export/share.create/share.revoke) | North region |
| `viewer@fms.local` | `View@1234` | Viewer (`live.view`, `vehicle.details.view`) | one hub |

## 7. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F01-T1 | contract | Every REST response in the suite parses with its zod schema. |
| F01-T2 | contract | WS: subscribing as `ops` returns `subscribed`, then snapshot chunks, then a delta within 2 × `MOCK_BATCH_MS`. All messages parse with their schemas. |
| F01-T3 | unit | The generator is deterministic: the same seed and time give an identical row. Row count equals `MOCK_VEHICLES`. |
| F01-T4 | unit | Over 100k vehicles, the generated raw fields produce every F05 status at least once. Checked with a reference implementation of the rules in the test. |
| F01-T5 | integration | Scope: `viewer` subscribing outside its hub gets `4403`. Its snapshot contains only hub vehicles. |
| F01-T6 | integration | Auth flows: login/logout/me; forgot → mailbox → reset → login; invite → accept → login; expired token gives `410` (via the dev clock). |
| F01-T7 | integration | Share: create → the public fetch works → a vehicle-scoped WS gets the payload with hidden groups removed → revoke → the socket closes with `4410` and the fetch returns `410`. |
| F01-T8 | integration | Fleet depth: creating a 6th level returns `422 max_depth`. Moving vehicles updates their `fleetId` in the next deltas. |
| F01-T9 | perf | With 100k vehicles, the snapshot reaches a local client in ≤ 2 s. Mock CPU stays < 1 core at the default rate. Measured by a script, not a unit test. |

All tests run against an in-process server on a random port, with `MOCK_VEHICLES` lowered (e.g. 2000), except T3, T4 and T9.

## 8. Out of scope
Persistence, real email, rate limiting, resuming after reconnect (`resume` from seq), a binary wire format. The last two are candidates for a later perf feature if real-backend tests call for them.
