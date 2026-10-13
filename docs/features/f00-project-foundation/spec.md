# F00 — Project Foundation · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Branch | `feature/f00-project-foundation` |
| Env | Node 24, pnpm 10 |

## 1. Functional requirements

| ID | Requirement |
|---|---|
| F00-R1 | Single pnpm package at the repo root, with TypeScript `strict: true` and `noUncheckedIndexedAccess: true`. |
| F00-R2 | Path aliases are `@/` → `src/` and `@shared/` → `shared/`. Vite, TS, Vitest and the mock server all resolve them. |
| F00-R3 | The folder structure follows `01-architecture.md` §3. Empty folders get a `.gitkeep`. |
| F00-R4 | Vite + React 19 app. `.env.example` documents `VITE_MAP_STYLE_URL` (default OpenFreeMap dark style) and `MOCK_PORT` (default 4000). |
| F00-R5 | Mock server **stub**: Fastify on `MOCK_PORT` with only `GET /api/health → {ok:true}`. F01 replaces it with the full mock. Run with `tsx watch`. |
| F00-R6 | The Vite dev server proxies `/api` (HTTP) and `/ws` (WebSocket upgrade) to the mock server, so cookies are same-origin. |
| F00-R7 | `pnpm dev` runs Vite and the mock server together (`concurrently`, with prefixed output and kill-others-on-fail). |
| F00-R8 | Tailwind v4 + shadcn/ui are initialised. The design tokens in §2 live as CSS variables in `src/shared/styles/theme.css`. Dark only, with no theme toggle. |
| F00-R9 | Fonts: a dot-matrix display font, Doto from Google Fonts or self-hosted, as `--font-display` for IDs and numbers. Inter as `--font-sans`. |
| F00-R10 | TanStack Router with code-based routes: `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/live-tracking` (index redirects here), `/admin` (+ `/admin/fleets`, `/admin/users`, `/admin/invites`, `/admin/roles`), `/share/$token`, and a 404 route. Every route is a placeholder page showing its title. |
| F00-R11 | **App layout** (wraps `/live-tracking` and `/admin/*`):<br>• Left icon nav on ≥ 1024 px.<br>• Slide-in drawer from a top-bar menu button below 1024 px.<br>• A top bar with a slot for page actions.<br>• Auth and public routes render without the shell. |
| F00-R12 | ESLint flat config: typescript-eslint, react-hooks, and `eslint-plugin-check-file`. That plugin enforces **kebab-case** names for every file and folder under `src/`, `shared/`, `mock-server/` and `e2e/`, ignoring config files. Prettier handles formatting. |
| F00-R13 | `src/shared/lib/format-date.ts` exports `formatIst(epochMs)`, which returns `DD MMM YY \| HH:mm:ss` in Asia/Kolkata, e.g. `08 Sep 26 \| 09:33:42`. It comes with unit tests. This is the shared formatter later features use. |
| F00-R14 | Vitest config:<br>• jsdom environment.<br>• `testTimeout: 5000`, `hookTimeout: 10000`.<br>• Includes `src/**/*.test.ts(x)`, `shared/**/*.test.ts` and `mock-server/**/*.test.ts`.<br>• Testing Library set up. |
| F00-R15 | Playwright config:<br>• Chromium only.<br>• `timeout: 30000`, `expect.timeout: 5000`, `retries: 0`, `workers: 2`.<br>• `webServer` starts `pnpm dev` and waits for `http://localhost:5173` (`timeout: 60000`, `reuseExistingServer: true`).<br>• Reporter `list` + `html` (open: never). |
| F00-R16 | Scripts:<br>• `dev`, `build`, `preview`.<br>• `lint`, `lint:fix`, `format`, `typecheck`.<br>• `test` (`vitest run`), `e2e` (`playwright test`).<br>• `check` (typecheck + lint + test). |
| F00-R17 | README: prerequisites, setup, scripts, folder map, and links to `docs/`. |
| F00-R18 | Git: `.gitignore` stays as committed (`reference/` excluded). |

## 2. Design tokens (from `reference/current-app-view*.png`). **Superseded by DS1** (`docs/features/ds1-design-refresh/spec.md`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0E0E0F` | app background / map surround |
| `--surface-1` | `#18181A` | panels |
| `--surface-2` | `#212124` | cards inside panels |
| `--border` | `#2C2C30` | 1px dividers / card borders |
| `--text` | `#F2F2F2` | primary text |
| `--text-muted` | `#9A9AA0` | labels (uppercase, letter-spaced) |
| `--accent` | `#D32F45` | primary buttons, focus |
| `--accent-soft` | `#3A1A20` | pill backgrounds |
| `--ok` | `#4ADE80` | positive metric values (DTE, SOH) |
| `--warn` | `#F5A524` | battery bar, warnings |
| `--radius-card` | `14px` | cards; `--radius-panel` `20px` |

Status colours are defined here and used by F05 onwards:

| Status | Variable | Colour |
|---|---|---|
| running | `--st-running` | `#22C55E` |
| stopped | `--st-stopped` | `#EF4444` |
| immobilized | `--st-immobilized` | `#A855F7` |
| non-comm | `--st-noncomm` | `#71717A` |
| charging | `--st-charging` | `#3B82F6` |
| pullout | `--st-pullout` | `#F43F5E` |
| no-gps | `--st-nogps` | `#F59E0B` |
| gps-never | `--st-gpsnever` | `#52525B` |

## 3. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F00-T1 | unit | `formatIst(1788840222971)` returns `08 Sep 26 \| 09:33:42`. Also covers a midnight boundary and a single-digit day. |
| F00-T2 | unit | Smoke test: the app renders the `/live-tracking` placeholder inside the layout. |
| F00-T3 | lint | A temporary file `src/BadName.ts` makes `pnpm lint` fail. The file is removed after the check. |
| F00-T4 | e2e | `/` redirects to `/live-tracking`, and the nav and title are visible. |
| F00-T5 | e2e | At a 390 px viewport, the nav is hidden, and the menu button opens the drawer. |
| F00-T6 | e2e | `GET /api/health` through the Vite proxy returns `{ok:true}`. |
| F00-T7 | cmd | `pnpm check` and `pnpm build` both exit 0. |

## 4. Out of scope
Feature UI, the real mock endpoints (F01), auth guards (F02).
