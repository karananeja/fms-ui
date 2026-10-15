# CLAUDE.md — fms-ui

Fleet management web app: live tracking of up to 1 lakh vehicles, admin screens (fleets, users, roles, invites) and public share links.
React 19 + Vite + TypeScript + TanStack Router/Table/Virtual + Tailwind v4/shadcn + MapLibre + Comlink worker, with a Fastify mock backend (`mock-server/`) and a zod contract in `shared/contract/`.
Setup, scripts and env vars: `README.md`. Seed and e2e accounts: `docs/03-dev-accounts.md`.

## Project status (2026-10-16)

| ID | Feature | State |
|---|---|---|
| F00 | Project foundation | Done, accepted |
| F01 | Mock server & API/WS contract | Done, accepted |
| F02 | Authentication | Done, accepted |
| F03 | Access control (fleets, users, invites, roles) | Done, accepted |
| F04 | Live data pipeline (worker + WS) | Done, accepted |
| F05 | Vehicle status derivation | Done, accepted |
| F06 | Live map | Done, accepted |
| DS1 | Design refresh ("Dark ops console") | Done, accepted |
| F07 | Vehicle details panel | Done, accepted |
| F08 | Status bar: search, counters, filters | Done, accepted |
| F09 | Table view & CSV export (+ D-079 hardening) | Done, accepted |
| F10 | Share live location | Done, accepted |
| F11 | Driver data & mock contract | Done, accepted |
| F12, F15 | Drivers & assignment, in-app notifications (+ DS2 auth backdrop) | Done, accepted |
| F13, F14 | Driver page (integrated report + voice), request desk (+ street-grid mock routes) | Done, accepted |
| F16 | Performance dashboard | Done, accepted |
| F17 | Fleet assistant | Done, accepted. Real-key smoke test pending |
| DS3, F18 | Themes & fonts; dashboard store (node:sqlite) | Done, accepted 2026-10-15 |
| F19, F20, F21 | AI dashboard builder (+ widget previews D-135, voice input); `/dashboards` route & UI; AI provider choice (xAI/OpenAI/Anthropic, D-134) | Done, accepted 2026-10-15. Real-key (Grok) smoke test pending |
| F22–F27 | Persist admin data in SQLite; chat & dashboard UX (+ Retry after return D-155); prompt caching; user AI keys (needs `FMS_SECRET_KEY`); dynamic widgets; edit/view sharing; card snapshots (D-142); out-of-credits errors (D-156) | Done, accepted 2026-10-16. Real-key (Grok) smoke test pending (xAI team out of credits) |

Last `main` baseline (2026-10-16, after F22–F27): `pnpm check` 1242/1244 (F11-T3 time-of-day flake; `widget-query.perf` under load, passes alone), build clean, e2e chromium 114 passed, 17 screenshot tests skipped without `FMS_SHOTS`. Last decision: **D-156** (Part 3: D-112…D-156; no D-147…D-149). Chat DB schema v12.

### Done: Part 3 (`requirement-part-3.md`), DS3 + F18–F27
- Order: DS3, F18, F19, F20, F21, F22–F27 all done. Accepted decisions D-112…D-156 (F22: D-136…D-140 SQLite write-through stores, seed marker, hashed tokens, vehicle moves only, atomic(); node:sqlite, react-grid-layout, Inter via Google Fonts link + Doto display-only, light/dark/system themes, generative dashboards from a fixed widget catalogue with view-only sharing; DS3 basemap/tokens; F18 DB layout, contract, sharing/threads/undo).
- F18 store API for F19/F20: `mock-server/store/dashboards.ts` (`appendMessage`, `applyTurn`, `undo`, `shareCandidates`…); contract `shared/contract/dashboards.ts`. Live widgets use the worker's read-only `queryWidgets` (D-129). AI provider: `FMS_ASSISTANT_PROVIDER`/`FMS_ASSISTANT_MODEL` + per-provider keys in `.env` (D-134, see `.env.example`).

### Done: Part 2 (`requirement-part-2.md`), F11–F17
- All intents and specs are signed off (2026-10-14); see `docs/02-feature-catalog.md` and `docs/features/f11-…`–`f17-…/spec.md`.
- Known flakes to fix: F09-T8 (tray after a pan) and F11-T3 replacement engine (`mock-server/store/requests.test.ts`) are time-of-day dependent; F06-T6 auto-fit centre tolerance after D-111 street-grid routes.
- Seed driver: `driver@fms.local` / `Drive@1234` (F11).
- Order: F11–F17 all done → F17 (F17a server ∥ F17b client). Stop for UAT after each step.
- Decision IDs: F11 D-092…D-094, F12 D-095…D-096, F15 D-097…D-098, F13 D-099…D-100, F14 D-101…D-102, F16 D-103…D-104, F17 D-105…D-107.
- Approved dependencies (still need their decision rows): `@anthropic-ai/sdk` and `pdf-lib` (server only, F17). No chart library (F16 uses in-house SVG).

## SDLC process (follow strictly)
- Each feature folder `docs/features/<id>-<name>/` holds `intent.md` → `spec.md` (each signed off by the user) → `conversation-log.md` → `test-report.md` (+ `screenshots/`).
- A feature is Done only when it is Implemented → Tested → User-accepted (UAT) → Signed off. Update `docs/02-feature-catalog.md` at each step.
- Decisions go in `docs/decision-log.md` as new rows (never edit past entries; supersede them). Agents add rows as **Proposed**; they become **Accepted** only after user approval.
- Log every session in `docs/conversation-logs/project-conversation-log.md`: dated heading, **User:** quote, **Assistant:** summary, **Status/Next**.
- When the user says "continue" or "approved" after a report, that means UAT acceptance and approval of the proposed decisions. Then merge with `--no-ff` into `main` and remove the worktrees and branches.
- Commit docs straight to `main`. Feature code goes on feature branches and merges `--no-ff`.

## Conventions
- Every file and folder name is kebab-case (lint-enforced). `@/` → `src/`, `@shared/` → `shared/`.
- Light / Dark / System themes (DS3, D-115, D-118): tokens in `src/shared/styles/theme.css` (`:root` dark, `[data-theme='light']`); no hard-coded colours, palette classes or `dark:` variants outside it. Inter is the body font; Doto (`font-display`, 800/900) only on brand, page titles, big KPI and status counter numbers (D-114). Times are shown in IST.
- The main thread stays light. Fleet state, search, filters, clustering and CSV all live in the Web Worker (D-005). The public share page must **not** import the live-tracking store, worker or admin code.
- Permission checks go through `can()` / `useCan` / `staticData.permission` (F03).
- No new dependencies without a decision entry.
- The `reference/` folder (git-ignored) holds **inspiration only**. Never clone the existing app's look; agree any new visual direction with the user first.

## Working style (user preferences)
- Speed matters: about 25 min per feature felt too slow. While iterating, run only targeted tests (`pnpm vitest run <file>`, `pnpm playwright test <spec>`). Run the full `pnpm check` + `pnpm build` + e2e **once** at the end. Run perf only when the change can affect budgets.
- **No git worktrees** (user, 2026-10-14). Do all work, including parallel agents, in this checkout on one branch. Give agents disjoint files and their own `VITE_PORT`/`MOCK_PORT`. Agents don't commit; the orchestrator does.
- Work autonomously. Ask the user only before critical steps (merge to `main`, deletes, pushes, new deps, spec/contract changes).
- Use the Read/Grep/Edit tools and simple single Bash commands.
- Agents stop only processes they started (by PID). Never `pkill -f` a pattern that can match the user's own `pnpm dev` (5173/4000).
- Under load, perf e2e can be flaky (load avg > 5). Re-run the single failing spec before calling it a regression, and compare against `main`.

## Commands
`pnpm dev` · `pnpm check` (typecheck + lint + vitest) · `pnpm build` · `pnpm e2e` (Playwright projects: `setup`, `chromium`, `perf`, `clock`) · `pnpm mock`.
Run e2e on non-default ports with `VITE_PORT=5273 MOCK_PORT=4101 pnpm playwright test --project=setup --project=chromium`.
UAT screenshots are opt-in: `FMS_SHOTS=1` (plus `FMS_E2E_FONTS=1` for real Inter). Capture only the feature under UAT. e2e uses `MOCK_DB=:memory:`; the dev mock writes `mock-server/data/fms.db` (git-ignored).
