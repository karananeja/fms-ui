# 00 — Requirements Analysis & Gap Report

| Field | Value |
|---|---|
| Phase | SDLC Phase 0: Requirement analysis (pre-architecture) |
| Status | **Answered — 2026-10-13** |
| Source | `requirement.md`, `caninfo.md`, `lafparsed.md`, `reference/*` |
| Date | 2026-10-13 |

## 1. What we understood

A web app for a fleet management service. The first and only module is **Live Tracking**. It shows vehicles on an OpenStreetMap-based map and reports each vehicle's live state from GPS and CAN metrics. The data comes over a WebSocket on two topics, and each topic can be subscribed per vehicle or per fleet.

Platform capabilities around the module:
- Invite-only sign-up, sign-in and forgot-password.
- Permission-based access with a fleet hierarchy. Vehicles belong to fleets, and users are granted fleets.
- Public, shareable live-tracking links for a vehicle.

Non-functional constraints:
- WebSocket handling runs inside a Web Worker. The main thread stays thin, and the design target is **1,000,000 vehicles**.
- Business logic lives in a class-based `live-tracking-store.ts`. React components only render.
- File names use kebab-case.
- The process is SDLC-driven: a spec and intent per feature, user sign-off, a sub-agent for each implementation, conversation and decision logs, and testing with bounded timeouts.

## 2. Observations from the data samples

### `combinfo` (caninfo.md)
- Identity fields: `deviceid`, `vehicleid`, `regno`, `chasiss` (misspelt). In the sample, `regno` == `chasiss`. **No explicit `vinno` field** exists, so we assume VIN = `chasiss`.
- GPS fields: `latitude`, `longitude`, `speed`, `heading`, `gpstime`, `fixquality`, `lastvalidfix`, `rxdbm`.
- Power fields: `carbattery` (aux voltage, 0.07 V in the sample), `devbattery` (device internal, 3.60 V).
- State fields: `ignstatus`, `devstate`, `lastignon`, `lastignoff`, `displayStatus` ("stopped").
- `parsedcandata` holds a curated subset of 7–8 PIDs: soc, dte, odometer, current, engine_speed, motor_temperature, immobilization_status, vehicle_mode_status.
- `appmeta` is free-form vehicle metadata (manufacturer, model, variant, fuel type, kWh, voltage). Some of it is nested `legacy_*`.
- There are several timestamps: `proctime`, `utctime`, `gpstime`, `kafkatime`, `canutctime`. In the sample, `proctime` is about 31 h after `gpstime`.

### `caninfo/lafparsed` (lafparsed.md)
- Keyed **only by `deviceid`**. It has no regno or vehicleid, so the client must join it with `combinfo` on `deviceid`.
- `candata` holds **374 PIDs**, each `{pidvalue, valtype, timestamp}`. Every PID in the sample has `valtype = 2`.
- It also carries `plsign`, which looks like a payload signature, plus `uptime` and `msgtimestamp`.
- **No labels, units, enums or thresholds** come with the PIDs. Examples:
  - `vehicle_mode_status = 9`: we don't know what 9 means.
  - `time_to_charge = 65535`: likely an "N/A" sentinel.
  - `remaining_range = 0` while `dte = 56`.
  - `mcu_speed = 20` while GPS `speed = 0`.

### Reference UI (current app)
- Dark theme, red accent, dot-matrix display font for IDs and numbers.
- Vehicle card sections:
  - Header: regno, copy and locate actions, make·model·variant, fuel badge, a status pill ("Pulled out"), and GPS and CAN freshness timestamps.
  - Driving·Energy: speed, battery, DTE, SOH, ODO.
  - Parameters: a searchable grid that expands into a full-width detail view with speed and RPM gauges.
  - Device & Comms: device ID, aux voltage, internal battery voltage.
  - Reports and Analytics buttons.
  - Location, and Share live location.
- The status pill shows "Pulled out" while the payload says `displayStatus: "stopped"`. So status is **derived** somewhere.

## 3. Gaps & risks identified

### A. Scale (biggest architectural risk)
1. **1M vehicles × about 2 KB `combinfo` JSON ≈ 2 GB per full snapshot.** Neither the browser nor the network can take a full-fidelity fleet stream at that size. We need a slim "position/state" stream and must fetch the full payload only for the selected vehicle. Viewport-based subscription would also help.
2. **Rendering.** DOM markers (classic Leaflet) top out at about 5–10k. 1M points needs WebGL: MapLibre GL, possibly deck.gl, with clustering done in the worker.
3. **Table view and CSV export** of 1M rows need a virtualised table, plus CSV built and streamed inside the worker.
4. **OSM tiles.** The public `tile.openstreetmap.org` usage policy forbids heavy or production use. We need a tile provider or a self-hosted tile server.
5. **Main-thread store vs worker.** `live-tracking-store.ts` must be a thin facade over the worker's data, not a copy of it. Otherwise 1M records get cloned onto the main thread.

### B. Data contract
6. The WS protocol is undefined: URL, auth, subscribe/unsubscribe message format, topic naming, fleet vs vehicle subscriptions, whether an initial snapshot arrives, delta vs full messages, message rate, and reconnect/resume.
7. We need a PID dictionary with label, unit, enum mapping, precision, sentinels, display group, and which PIDs appear in the "Parameters" list.
8. The vehicle status taxonomy and its derivation rules are missing. Candidates: moving, idle, stopped, offline, pulled out, charging, no-GPS. Thresholds for stale or offline are also needed.
9. Which timestamp is the source of truth for freshness and ordering? What do we do with out-of-order messages?
10. Is `plsign` verified client-side?

### C. Backend / platform
11. Does a backend already exist (the Intellicar platform)? If so, are there API specs for auth, invites, users, fleets, vehicles and share links? If not, is the UI built against mocks?
12. The fleet hierarchy's shape is unclear: org → fleet → sub-fleet (nested, any depth)? Can a vehicle sit in several fleets?
13. The role and permission model is undefined: roles, permission granularity, and who can invite or share.
14. The auth mechanism is undefined: JWT, cookie session or SSO. So are the token refresh path and how the WS authenticates.
15. Share links need rules for:
    - Expiry and revocation.
    - What the public viewer sees: position only, or metrics too?
    - Whether the trail is shown.
    - How the public page gets data (scoped token on the same WS?).

### D. Feature semantics
16. Search covers `vinno`, `regno` and `deviceid`. Is it prefix, contains or fuzzy? Should it filter the map or just jump to the vehicle?
17. Filters: which fields (status, fleet, asset type, fuel type, SOC range, model…)? Do they also apply to the table and the CSV?
18. "Zoom to fit": fit once on first data load, or on demand via a button (or both)?
19. Default location comes from profile settings. Is a full profile/settings page in scope?
20. City dropdown: we need the city list (top N Indian cities?) and whether selecting a city also filters vehicles or only pans the map.
21. Quick locate: does it fly to and follow the vehicle (auto-pan as it moves)?
22. Is a live trail/breadcrumb polyline for the selected vehicle needed?
23. Are Reports and Analytics (seen in the reference) in scope? Assumed out of scope for now.

### E. UX / product
24. Theme: the current app is dark, but several references are light. Do we need dark only, light only, or both with a toggle?
25. Platform targets: desktop web only, responsive/mobile web, or native later?
26. Locale and units: IST display, date format `08 Sep 26 | 09:33:42`, i18n, km/h.

### F. Process
27. Git isn't initialised yet. We need the remote repo and a branching strategy.
28. Sign-off mechanism: reply in chat, or edit a status field in the spec?
29. Testing: which test types are required (unit, component, e2e)? What hard timeout budget should tests have?

## 4. Answers log (2026-10-13)

| # | Topic | Answer | Interpretation / follow-up |
|---|---|---|---|
| A1 | Backend / WS spec | Build a mock server | We author the API + WS contract (D-003) |
| A2 | Slim fleet stream + viewport filter | Backend can send | Fleet topic = slim records; full payload per selected vehicle (D-004) |
| A3 | Scale | ~1 lakh realistic, 10 lakh headroom | Design + perf budget for 1 lakh; architecture must not preclude 10 lakh |
| A4 | PID dictionary | `lafparsed.md` is the list; all of them appear in Parameters | No units/enums exist → labels humanised from keys, raw values shown; `65535` treated as N/A (assumption, in F07 intent) |
| A5 | Statuses | Client derives `displayStatus` (server may also send it). Statuses: total, running, stopped, immobilized, non-comm, charging, pullout, no-gps, gps-never | Rules not given → proposed in F05 intent for sign-off |
| A6 | Timestamps | Both | `gpstime` for location freshness, `canutctime` for CAN freshness. `plsign` not verified client-side (no key) — assumption |
| B7 | Fleet hierarchy | Any depth, capped at 5; a vehicle belongs to exactly one fleet | — |
| B8 | Roles | Super admin invites; permissions are granular | Permission catalogue proposed in F03 intent |
| B9 | Auth | Cookie session; WS authenticated by cookie on handshake | Same-origin WS (Vite proxy in dev) |
| B10 | Share link | Expiry + revocation; visible data, trail and validity chosen at link creation | — |
| C11 | Search | Prefix match; filters and jumps to vehicle | — |
| C12 | Filters | Status, fleet, vehicle type, fuel type, SOC range, make/model; also apply to table + CSV | — |
| C13 | Zoom to fit | Auto on first data + button | — |
| C14 | Profile settings / city filter | Not for now | Default map location = India; city dropdown only pans |
| C15 | Quick locate | Fly to vehicle (no follow) | — |
| C16 | Reports / Analytics | Out of scope | Buttons not rendered |
| D17 | Tech stack | Accepted as proposed | See `01-architecture.md` |
| D18 | Theme / devices | Responsive; theme toggle not needed | Dark theme only, built on CSS tokens |
| D19 | i18n / time format | No i18n; IST `08 Sep 26 \| 09:33:42` | — |
| E20 | Git / sign-off | Feature branch + PR | Sign-off = chat reply, recorded in the intent/spec status. **Git remote URL still needed** |
| E21 | Test timeouts | Accepted | Unit ≤5 s, e2e ≤30 s, 0 retries, stop after 2 failed attempts (D-011) |
