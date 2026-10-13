# Decision Log

Format: one entry per decision; never edit past entries — supersede them.

| # | Date | Decision | Rationale | Status | Supersedes |
|---|---|---|---|---|---|
| D-001 | 2026-10-13 | `reference/` media is git-ignored | Requirement: reference media must not be pushed | Accepted | — |
| D-002 | 2026-10-13 | SDLC docs live in `docs/` (`features/<id>-<name>/` holds intent, spec, conversation log) | Keep process artifacts versioned with code | Accepted | — |
| D-003 | 2026-10-13 | Build a Fastify mock server (REST + WS); contract defined in `shared/` zod schemas | No backend spec available (A1) | Accepted | — |
| D-004 | 2026-10-13 | Two-tier stream: slim fleet-level records; full `combinfo` + `lafparsed` only for selected/shared vehicle | 1 lakh × ~2 KB full payloads is too heavy; backend can send slim data (A2) | Accepted | — |
| D-005 | 2026-10-13 | Fleet state, search, filters, clustering, table queries and CSV all live in the Web Worker; `LiveTrackingStore` is a main-thread facade holding UI state + small worker results | Requirement: main thread extremely light; avoids cloning fleet to main thread | Accepted | — |
| D-006 | 2026-10-13 | MapLibre GL JS + OSM vector tiles; style URL via env; dev = OpenFreeMap, prod = tile provider or self-hosted Protomaps | DOM markers can't scale; OSM public tile server policy forbids production load | Accepted | — |
| D-007 | 2026-10-13 | Stack: React 19, Vite, TS, TanStack Router/Query/Table/Virtual, Tailwind v4 + shadcn/ui, Comlink, supercluster, Vitest, Playwright, pnpm | Accepted by user (D17) | Accepted | — |
| D-008 | 2026-10-13 | Dark theme only, built on CSS tokens; fully responsive | D18 | Accepted | — |
| D-009 | 2026-10-13 | No i18n; timestamps shown in IST as `DD MMM YY \| HH:mm:ss` | D19 | Accepted | — |
| D-010 | 2026-10-13 | Location freshness from `gpstime`, CAN freshness from `canutctime`; `plsign` not verified client-side | A6; no verification key available | Accepted | — |
| D-011 | 2026-10-13 | Test guardrails: unit ≤5 s, e2e ≤30 s, 0 retries, no watch mode, explicit command timeouts, agent stops after 2 failed fix attempts | E21 | Accepted | — |
| D-012 | 2026-10-13 | Workflow: one feature branch + PR per feature; sign-off = user's chat reply, recorded in the feature's intent/spec status | E20 | Accepted | — |
| D-013 | 2026-10-13 | Reports/Analytics and profile settings out of scope; default map location = India; city dropdown pans only | C14, C16 | Accepted | — |
| D-014 | 2026-10-13 | Local git only (no remote); feature branch per feature, merged locally to `main` after sign-off | User answer; supersedes the PR part of D-012 | Accepted | D-012 (partially) |
| D-015 | 2026-10-13 | Status rules (F05) accepted as proposed; all thresholds/PIDs/priority in one config module | User: "yes but make it configurable" | Accepted | — |
| D-016 | 2026-10-13 | Admin screens (fleet tree, users, invites, roles) in scope | User answer | Accepted | — |
| D-017 | 2026-10-13 | Parameters grid shows raw values, no units | User answer | Accepted | — |
| D-018 | 2026-10-13 | Password policy: ≥8 chars, ≥1 letter, ≥1 number | User answer | Accepted | — |
| D-019 | 2026-10-13 | Fonts self-hosted via Fontsource: `@fontsource/doto` (700) for `--font-display`, `@fontsource-variable/inter` for `--font-sans` | No runtime dependency on Google Fonts CDN; works offline and in e2e | Accepted | — |
| D-020 | 2026-10-13 | Dev map style default `https://tiles.openfreemap.org/styles/dark` (`VITE_MAP_STYLE_URL`) | OpenFreeMap dark style, no API key (per D-006) | Accepted | — |
| D-021 | 2026-10-13 | TypeScript pinned to 6.0.x (not 7.x) | typescript-eslint 8.x peer range is `<6.1.0`; TS 7 (native port) not yet supported | Accepted | — |
| D-022 | 2026-10-13 | shadcn/ui aliases: ui → `src/shared/ui`, utils → `src/shared/lib/utils.ts`; primitives use the `radix-ui` umbrella package. Page titles come from TanStack Router `staticData.title`; top-bar actions via a `<PageActions>` portal | Keeps primitives under `src/shared` per architecture §3; one source for page titles | Accepted | — |
