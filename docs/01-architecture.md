# 01 — Technical Architecture

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Date | 2026-10-13 |
| Inputs | `00-requirements-analysis.md` (answers log), `decision-log.md` |

## 1. Goals & budgets

| Budget | Target (1 lakh vehicles) | Headroom target (10 lakh) |
|---|---|---|
| Main-thread long tasks during live updates | none > 50 ms | none > 50 ms |
| Map frame rate while panning | ≥ 50 fps | ≥ 30 fps |
| Worker → UI push rate | ≤ 4 Hz (batched) | ≤ 2 Hz |
| Time from WS connect to first markers | ≤ 2 s | ≤ 5 s |
| Worker memory for fleet state | ≤ 60 MB | ≤ 400 MB |
| Search keystroke → results | ≤ 50 ms | ≤ 150 ms |

## 2. Tech stack

| Concern | Choice |
|---|---|
| Language / build | TypeScript (strict), Vite, pnpm |
| UI | React 19, Tailwind CSS v4, shadcn/ui (Radix), lucide icons |
| Routing | TanStack Router |
| REST data (auth, fleets, share links) | TanStack Query + `fetch` with `credentials: 'include'` |
| Forms / validation | react-hook-form + zod (zod schemas shared with mock server) |
| Map | MapLibre GL JS with OSM-based vector tiles. The style URL is env-configurable. Dev uses OpenFreeMap (no key). Prod needs a provider or self-hosted Protomaps (D-006). |
| Clustering | supercluster (inside the worker) |
| Worker RPC | Comlink |
| React ⇄ store | `useSyncExternalStore` over `LiveTrackingStore` selectors |
| Tables | TanStack Table + TanStack Virtual |
| Mock backend | Node + Fastify + `@fastify/websocket`, run with `tsx` |
| Tests | Vitest + Testing Library (unit/component), Playwright (e2e), against the mock server |
| Lint / format | ESLint (incl. `eslint-plugin-check-file` to enforce kebab-case file names), Prettier |

## 3. Repository layout

```
fms-ui/
├─ docs/                         SDLC artifacts (analysis, architecture, decisions, logs, features/*)
├─ mock-server/                  Fastify REST + WS mock, data generator (1 lakh synthetic vehicles)
├─ shared/                       zod schemas + TS types for the API/WS contract (used by both)
├─ src/
│  ├─ app/                       router, providers, layout shell
│  ├─ features/
│  │  ├─ auth/                   sign-in, forgot/reset password, accept-invite
│  │  ├─ access/                 users, invites, fleets, permissions (super admin)
│  │  ├─ live-tracking/
│  │  │  ├─ store/live-tracking-store.ts     ← single source of business logic on main thread
│  │  │  ├─ worker/live-tracking-worker.ts  ← WS, state, index, clustering, filtering, CSV
│  │  │  ├─ worker/*.ts                     status-deriver, search-index, vehicle-table, …
│  │  │  └─ components/*.tsx                 thin view components
│  │  └─ share/                  create/manage links, public viewer page
│  ├─ shared/                    ui primitives, hooks, formatters (IST date format), api client
│  └─ main.tsx
└─ e2e/                          Playwright specs
```

All file names are kebab-case (lint-enforced). Classes and components keep their PascalCase identifiers.

## 4. Live-tracking data flow

```
 Mock/real WS ──► live-tracking-worker (Web Worker)
                   ├─ ws-client: connect, auth by cookie, subscribe, backoff reconnect, resume
                   ├─ fleet-state: struct-of-arrays (Float64Array lat/lng, Float32 speed/heading/soc,
                   │               Uint8 status, Uint32 timestamps, string[] ids) + id→index map
                   ├─ status-deriver: rules from F05 → status code per vehicle, status counts
                   ├─ search-index: sorted prefix arrays for vinno / regno / deviceid
                   ├─ filter-engine: bitset of matching vehicles (status, fleet, type, fuel, soc, model)
                   ├─ cluster-index: supercluster, rebuilt on a throttle (≤1/s) over filtered set
                   ├─ table-query: sort + page/window over filtered set (full or viewport)
                   └─ csv-exporter: streams filtered rows → Blob (transferred)
                        │  Comlink: request/response + batched push (≤4 Hz)
                        ▼
 LiveTrackingStore (main thread, class)
   - owns UI state only: viewport, selection, filters, search text, table mode, connection state
   - forwards intents to worker; caches the *small* results the worker returns
     (clusters/points for current viewport+zoom, counts, visible table window, selected vehicle)
   - exposes subscribe()/getSnapshot() selectors for useSyncExternalStore
                        ▼
 React components (map, status bar, filters, detail panel, table) — render only
```

Key rules:
- **The main thread never holds the fleet.** It only receives what is on screen: at most a few thousand clusters or points, about 50 table rows, and one selected vehicle.
- **Two subscription levels**, per your answers:
  - Fleet level: a slim record per vehicle (id, regno, vin, deviceid, fleetId, lat, lng, speed, heading, soc, ignition, key flags, timestamps).
  - Vehicle level: the full `combinfo` and `lafparsed` for the selected vehicle and for the public share page.
- `combinfo` and `lafparsed` are joined on `deviceid`.
- **Freshness:** `gpstime` drives location freshness and `canutctime` drives CAN freshness. Older messages are dropped per vehicle.
- **Startup:**
  1. The app shell loads and the session is checked.
  2. The worker spawns and opens the WS.
  3. The map initialises at the India default.
  4. The first full fleet batch arrives and the map auto-fits once.

## 5. Mock server contract (summary — detailed in F01 spec)

- REST endpoints (cookie session):
  - Auth: `/api/auth/*` (login, logout, me, forgot, reset, accept-invite).
  - Users and invites: `/api/users`, `/api/invites`.
  - Fleets: `/api/fleets` (tree, ≤5 levels).
  - Share links: `/api/share-links`.
  - Public share link data: `/api/public/share/:token`.
- WS `/ws/live`, message envelope `{type, topic, scope, data}`:
  - Client → server: `subscribe` / `unsubscribe` with `{topic: 'combinfo' | 'lafparsed', scope: {fleetId} | {vehicleId}}`.
  - Server → client: `snapshot` (chunked), `delta` (batched array), `heartbeat`, `error`.
- The generator produces about 1 lakh vehicles, built from the sample payloads, across a 5-level fleet tree. It moves them on Indian road-ish paths at a configurable rate. A `MOCK_VEHICLES=1000000` stress mode is also available.

## 6. Security model

- HttpOnly, SameSite=Lax session cookie. The WS is same-origin, so the browser sends the cookie on the handshake. Dev uses the Vite proxy for `/api` and `/ws`.
- Permissions come from `/api/auth/me`:
  - The UI uses them only to hide or disable controls.
  - The server enforces them, which the mock does too.
  - Fleet scope limits which subscriptions are allowed.
- Public share links:
  - Each link has an opaque random token.
  - The server stores its expiry, revocation flag and display options.
  - The public page subscribes with the token, read-only, scoped to a single vehicle.

## 7. Testing & agent guardrails (D-011)

- Vitest `testTimeout: 5000`, `hookTimeout: 10000`, always `vitest run` (never watch), `--bail 1` in agent runs.
- Playwright `timeout: 30000`, `expect.timeout: 5000`, `retries: 0`, `workers: 2`. The mock server starts via `webServer` with `timeout: 60000`.
- Every agent shell command has an explicit timeout. Long-lived servers run in the background and are killed after the run.
- If a fix fails twice, the sub-agent stops and reports back instead of looping.
- Perf checks: a scripted 1-lakh scenario asserts the long-task and push-rate budgets in §1.
