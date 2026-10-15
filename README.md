# fms-ui

Fleet management web app: live tracking of up to 1 lakh vehicles, admin screens and public share links.
React 19 + Vite + TypeScript, with a Fastify mock backend for local development.

## Prerequisites

- Node 24+
- pnpm 10+

## Setup

```sh
pnpm install
cp .env.example .env              # optional; defaults work out of the box
pnpm exec playwright install chromium   # only needed for e2e tests
pnpm dev
```

Open <http://localhost:5173>. `/` redirects to `/live-tracking`.

`pnpm dev` runs Vite (port 5173) and the mock server (`MOCK_PORT`, default 4000) together.
Vite proxies `/api` and `/ws` to the mock server, so cookies stay same-origin.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `VITE_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/dark` | MapLibre style URL, dark theme (dev: OpenFreeMap, no key) |
| `VITE_MAP_STYLE_URL_LIGHT` | `https://tiles.openfreemap.org/styles/positron` | MapLibre style URL, light theme (DS3) |
| `VITE_DEV_LOGIN_EMAIL` | `superadmin@fms.local` | Dev-only auto sign-in when `/api/auth/me` is `401` (until F02); never in production builds |
| `VITE_DEV_LOGIN_PASSWORD` | `Admin@123` | Password for the dev auto sign-in |
| `MOCK_PORT` | `4000` | Mock server port, also the Vite proxy target |
| `MOCK_SEED` | `42` | Seed for the deterministic generator |
| `MOCK_VEHICLES` | `100000` | Synthetic vehicles (max `1000000`) |
| `MOCK_VEHICLE_INTERVAL_MS` | `10000` | Report interval per vehicle (±20% jitter) |
| `MOCK_BATCH_MS` | `500` | WS delta flush interval |
| `MOCK_SNAPSHOT_CHUNK` | `5000` | Rows per snapshot chunk / delta message |
| `MOCK_LOG_LEVEL` | `info` | Mock log level (`info` prints reset/invite links) |

### Mock server (F01)

The contract lives in `shared/contract/` (zod schemas + types); the full spec is
[docs/features/f01-mock-server/spec.md](docs/features/f01-mock-server/spec.md). Data is in memory and resets on restart.

Seed logins:

| Email | Password | Role | Scope |
|---|---|---|---|
| `superadmin@fms.local` | `Admin@123` | Super Admin | whole tree |
| `ops@fms.local` | `Ops@1234` | Operator | North region |
| `viewer@fms.local` | `View@1234` | Viewer | Delhi Hub 1 |

Dev-only endpoints (not registered when `NODE_ENV=production`):

- `GET /api/dev/mailbox?to=<email>`: the last reset / invite emails (with `url` and `token`).
- `POST /api/dev/clock` `{ "offsetMs": 1860000 }`: shifts the mock clock (expiry, non-comm); `0` resets it.
- `GET /api/dev/stats`: vehicles, sockets, subscriptions, CPU and memory of the mock.

### Live data pipeline (F04)

On load the app checks the session (`/api/auth/me`; in dev it signs in automatically with
`VITE_DEV_LOGIN_*`) and starts a Web Worker (`src/features/live-tracking/worker/`) that owns the
`/ws/live` socket and the whole fleet state. The main thread only gets coalesced pushes (≤ 4 Hz) via
`LiveTrackingStore` (`src/features/live-tracking/store/`). `/live-tracking` shows a temporary
diagnostics panel (connection, vehicle count, rows/s, state size, clock offset, vehicle picker).
In dev, `window.__fmsLive` exposes `{pushCount, firstDataAt, snapshotCompleteAt}`.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite + mock server (`concurrently`, prefixed output) |
| `pnpm mock` / `pnpm mock:once` | Mock server only (with / without restart on change) |
| `pnpm perf:mock [vehicles] [seconds]` | F01-T9: snapshot latency and mock CPU (default 100000, 20 s) |
| `pnpm build` | Typecheck and production build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm lint` / `pnpm lint:fix` | ESLint (incl. kebab-case file/folder names) |
| `pnpm format` | Prettier |
| `pnpm typecheck` | `tsc -b` |
| `pnpm test` | Vitest, single run (never watch) |
| `pnpm e2e` | Playwright (Chromium); starts `pnpm dev` itself. `*.perf.spec.ts` run last in the `perf` project |
| `FMS_SHOTS=1 pnpm e2e …` | Also writes the UAT screenshots into `docs/features/<id>/screenshots/` (off by default; add `FMS_E2E_FONTS=1` for real Inter). Capture only the feature under UAT, e.g. `FMS_SHOTS=1 pnpm playwright test e2e/themes.spec.ts` |
| `pnpm check` | typecheck + lint + test |

## Folder map

```
docs/          SDLC artifacts: requirements, architecture, decisions, feature intents/specs/logs
mock-server/   Fastify mock backend (REST + WS /ws/live), data generator, fixtures, tests
shared/        API/WS contract (zod schemas + types), imported as @shared/*
src/
  app/         router, app layout (side nav / drawer, top bar), providers
  features/    auth, access, live-tracking, share
  shared/      ui primitives (shadcn/ui), hooks, lib (formatters), api client, styles/theme.css
  main.tsx
e2e/           Playwright specs
```

Conventions: every file and folder name is kebab-case (lint-enforced). `@/` maps to `src/`, `@shared/` to `shared/`.
Dark theme only; design tokens live in `src/shared/styles/theme.css`.

## Docs

- [Requirements analysis](docs/00-requirements-analysis.md)
- [Architecture](docs/01-architecture.md)
- [Feature catalogue](docs/02-feature-catalog.md)
- [Decision log](docs/decision-log.md)
- [Feature folders](docs/features/)
