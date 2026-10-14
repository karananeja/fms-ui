# CLAUDE.md — fms-ui

Fleet management web app: live tracking of up to 1 lakh vehicles, admin screens (fleets, users, roles, invites) and public share links.
React 19 + Vite + TypeScript + TanStack Router/Table/Virtual + Tailwind v4/shadcn + MapLibre + Comlink worker, with a Fastify mock backend (`mock-server/`) and a zod contract in `shared/contract/`.
Setup, scripts and env vars: `README.md`. Seed and e2e accounts: `docs/03-dev-accounts.md`.

## Project status (2026-10-14)

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
| F16 | Performance dashboard | Done on `feature/f16-dashboard`, awaiting UAT (D-103, D-104 proposed) |
| F17 | Fleet assistant | Intent + spec signed off. Not started |

Last `main` baseline: `pnpm check` 716/716, build clean, e2e 54/55 (F09-T8 tray flake, pre-existing, also fails on the pre-F11 `main`), clock 4/4. Last decision: **D-111** (F12/F15 D-095…D-098; F13/F14 D-099…D-102; F16 D-103…D-104; D-109…D-111 driver report, voice, mock routes).

### Pending work: Part 2 (`requirement-part-2.md`), F11–F17
- All intents and specs are signed off (2026-10-14); see `docs/02-feature-catalog.md` and `docs/features/f11-…`–`f17-…/spec.md`.
- Known flakes to fix: F09-T8 (tray after a pan) and F11-T3 replacement engine (`mock-server/store/requests.test.ts`) are time-of-day dependent; F06-T6 auto-fit centre tolerance after D-111 street-grid routes.
- Seed driver: `driver@fms.local` / `Drive@1234` (F11).
- Order: F11–F15 (done) → F16 → F17 (F17a server ∥ F17b client). Stop for UAT after each step.
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
- Dark theme only (DS1 tokens in `src/shared/styles/theme.css`). Doto is the only font (D-054). Times are shown in IST.
- The main thread stays light. Fleet state, search, filters, clustering and CSV all live in the Web Worker (D-005). The public share page must **not** import the live-tracking store, worker or admin code.
- Permission checks go through `can()` / `useCan` / `staticData.permission` (F03).
- No new dependencies without a decision entry.
- The `reference/` folder (git-ignored) holds **inspiration only**. Never clone the existing app's look; agree any new visual direction with the user first.

## Working style (user preferences)
- Speed matters: about 25 min per feature felt too slow. While iterating, run only targeted tests (`pnpm vitest run <file>`, `pnpm playwright test <spec>`). Run the full `pnpm check` + `pnpm build` + e2e **once** at the end. Run perf only when the change can affect budgets.
- **No git worktrees** (user, 2026-10-14). Do all work, including parallel agents, in this checkout on one branch. Give agents disjoint files and their own `VITE_PORT`/`MOCK_PORT`. Agents don't commit; the orchestrator does.
- Work autonomously. Ask the user only before critical steps (merge to `main`, deletes, pushes, new deps, spec/contract changes).
- Use the Read/Grep/Edit tools and simple single Bash commands.
- Under load, perf e2e can be flaky (load avg > 5). Re-run the single failing spec before calling it a regression, and compare against `main`.

## Commands
`pnpm dev` · `pnpm check` (typecheck + lint + vitest) · `pnpm build` · `pnpm e2e` (Playwright projects: `setup`, `chromium`, `perf`, `clock`) · `pnpm mock`.
Run e2e on non-default ports with `VITE_PORT=5273 MOCK_PORT=4101 pnpm playwright test --project=setup --project=chromium`.
