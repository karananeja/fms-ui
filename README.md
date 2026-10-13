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
| `VITE_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/dark` | MapLibre style URL (dev: OpenFreeMap, no key) |
| `MOCK_PORT` | `4000` | Mock server port, also the Vite proxy target |

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite + mock server (`concurrently`, prefixed output) |
| `pnpm build` | Typecheck and production build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm lint` / `pnpm lint:fix` | ESLint (incl. kebab-case file/folder names) |
| `pnpm format` | Prettier |
| `pnpm typecheck` | `tsc -b` |
| `pnpm test` | Vitest, single run (never watch) |
| `pnpm e2e` | Playwright (Chromium); starts `pnpm dev` itself |
| `pnpm check` | typecheck + lint + test |

## Folder map

```
docs/          SDLC artifacts: requirements, architecture, decisions, feature intents/specs/logs
mock-server/   Fastify mock backend (REST + WS)
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
