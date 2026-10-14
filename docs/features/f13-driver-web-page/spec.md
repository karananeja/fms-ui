# F13 — Driver Web Page · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-14 (user)** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server contract | F11: `GET /api/driver/me`, `POST /api/requests`, `GET /api/requests?mine`, WS `events` with `{kind:'self'}`; the Driver role (`driver.self`); F02 sign-in. **No mock changes.** |
| Visual source of truth | **New screen: look proposed in §4, confirmed by UAT screenshots** (per CLAUDE.md). DS1 dark tokens + Doto, large touch targets. |
| Delivery | One agent in the main checkout, branch `feature/f13-driver-page`, ports 5273/4101, decisions **D-099…D-100**. Runs in parallel with F14 after F12/F15 are merged. |

## 1. Files (kebab-case)
```
src/features/driver/driver-entry.tsx            own boot path like F10's share-entry: no fleet worker, store, map or admin code
src/features/driver/api/driver-api.ts           me, create request, my requests
src/features/driver/pages/driver-home-page.tsx  /driver
src/features/driver/components/my-vehicle-card.tsx
src/features/driver/components/request-sheet.tsx      breakdown / replacement / RSA form
src/features/driver/components/request-timeline.tsx
src/features/driver/use-driver-events.ts        uses F15's shared events-socket with scope {kind:'self'}
src/main.tsx                                    + `/driver` branch (like `/share/`); sign-in redirects Driver role here
```

## 2. Requirements
| ID | Requirement |
|---|---|
| F13-R1 | **Routing and access.** A user with the Driver role who signs in (F02) lands on `/driver`. Every other app route sends a Driver to `/driver`, and staff routes stay forbidden. A staff user opening `/driver` sees No access. `/driver` loads its own small entry: no live-tracking worker, store, map or admin code (checked in the build output, like F10). |
| F13-R2 | **My vehicle card:** regno, make · model, status pill (F05 colours), last update (relative + IST), SOC and range when present, and the last known area as "lat, lng" with a "Open in Maps" link. It refreshes every 30 s and on `events`. **No vehicle assigned:** "No vehicle assigned. Contact your fleet operator." and the request buttons are disabled, except an open replacement shows status. |
| F13-R3 | **Three big actions:** **Report breakdown**, **Request replacement** and **Request RSA**. Each opens a bottom sheet. **Breakdown:** reason (the F11 `BreakdownReason` list as big radio cards), an optional note (280 chars) and "Share my location" (browser geolocation; on denial the vehicle's last fix is used). **Replacement and RSA:** optional note + location. Submitting shows a confirmation, and a request of a type that is already open opens that request instead of a duplicate (the server 409 is handled). |
| F13-R4 | **My requests:** open requests first, then the last 10 closed. **Each shows:** type, status pill, and a timeline of steps with times (IST) and the operator's notes, e.g. "RSA dispatched: Suresh, ETA 30 min". It updates live from WS `events`. When a replacement is **assigned**, the vehicle card switches to the new vehicle and a banner shows "Replacement assigned: MH12…". |
| F13-R5 | **Simple and robust:** mobile-first (360 px+). It works on slow networks: the actions show pending state, requests that fail to send can be retried, and WS reconnects with backoff, then re-syncs over REST. There's a sign-out in a small header menu. |
| F13-R6 | Main-thread only, with low volume. It reuses `events-socket.ts` from F15 (no second socket implementation). |

## 3. Budgets
- `/driver` JS ≤ 120 kB gzip, excluding React (no maplibre, no worker). The page is interactive within 2 s on mid-range mobile throttling (Playwright 4× CPU, Fast 3G) on the mock.
- A status change made by the operator shows on the driver page within 5 s.

## 4. Look (proposal, confirmed via UAT screenshots)
- Dark DS1, single column with a max width of 480 px and 16 px gutters. Header: the FMS mark + driver name + menu.
- The vehicle card is the F07 card style, condensed.
- The three actions are full-width 56 px buttons with icons: breakdown = danger tint, RSA = warning tint, replacement = accent gradient.
- Requests are cards with a vertical timeline.

## 5. Tests
| ID | Type | Test |
|---|---|---|
| F13-T1 | component | Request sheet validation and submit body per type; duplicate-open handling; no-vehicle state; timeline rendering. |
| F13-T2 | e2e | `driver@fms.local` signs in → lands on `/driver` → sees their vehicle → reports a breakdown with reason `tyre` → the request appears as Open. |
| F13-T3 | e2e (two contexts) | The driver requests RSA. The super admin acts through the F11 API (acknowledge → dispatch with ETA → resolve). The driver page shows each step live within 5 s, without reload. |
| F13-T4 | e2e | Replacement assigned through the API → the driver's vehicle card switches to the new regno and the banner shows. |
| F13-T5 | e2e | A Driver opening `/live-tracking` or `/admin` is sent to `/driver`. A staff user on `/driver` gets No access. The `/driver` chunk excludes the worker, store, map and admin code (build check by the orchestrator). |
| F13-T6 | e2e | UAT screenshots → `screenshots/`: home (with/without a vehicle), each request sheet, a request timeline, the replacement banner. Mobile 390 px + desktop. |
| F13-T7 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. |

## 6. Decisions to propose
- **D-099:** `/driver` has its own boot entry (like F10), and Driver-role routing.
- **D-100:** the driver page look (§4) and geolocation fallback to the vehicle's last fix.

## 7. Out of scope
Native app, push, offline queueing beyond retry, photos, chat with the operator.
