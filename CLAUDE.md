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

Last `main` baseline: `pnpm check` 679/679, build clean, e2e 55/55, clock 4/4. Last decision: **D-091**.

### Pending work
None. All catalogued features (F00–F10, DS1) are done and accepted.

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
