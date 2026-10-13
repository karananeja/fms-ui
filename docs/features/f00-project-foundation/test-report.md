# F00 — Project Foundation · Test Report

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Branch | `feature/f00-project-foundation` |
| Env | macOS, Node 24, pnpm 10.33, Vitest 5.0.4, Playwright 1.64 (Chromium) |
| Result | **All passed** |

## Acceptance tests

| ID | Type | Result | Command | Evidence |
|---|---|---|---|---|
| F00-T1 | unit | PASS | `pnpm test` | `formatIst > formats a timestamp in IST as DD MMM YY \| HH:mm:ss` (`1788840222971` → `08 Sep 26 \| 09:33:42`); `rolls over to the next IST day at UTC 18:30 (IST midnight)`; `zero-pads single-digit days, hours, minutes and seconds`; `uses three-letter month names` |
| F00-T2 | unit | PASS | `pnpm test` | `app shell > renders the /live-tracking placeholder inside the layout` (+ redirect, auth-without-shell and 404 tests) |
| F00-T3 | lint | PASS | `src/BadName.ts` created → `pnpm lint` → file deleted | `error  The filename "BadName.ts" does not match the "KEBAB_CASE" pattern  check-file/filename-naming-convention`, exit 1. File removed afterwards (`ls: src/BadName.ts: No such file or directory`). A non-kebab folder (`src/BadDir/`) also fails lint. |
| F00-T4 | e2e | PASS | `pnpm e2e` | `✓ redirects / to /live-tracking with nav and title visible (327ms)` |
| F00-T5 | e2e | PASS | `pnpm e2e` | `✓ mobile viewport › hides the side nav and opens the drawer from the menu button (2.2s)` (390×844; also navigates via the drawer and checks it closes) |
| F00-T6 | e2e | PASS | `pnpm e2e` | `✓ GET /api/health through the Vite proxy returns ok (17ms)` |
| F00-T7 | cmd | PASS | `pnpm check`, `pnpm build` | both exit 0 (see below) |

Unit totals: `Test Files 3 passed (3) · Tests 9 passed (9)` in ~0.7 s (includes a `fastify.inject` test for the mock stub).
E2E totals: `3 passed (3.4s)` with 2 workers; servers started and stopped by Playwright `webServer`. Ports 5173/4000 free after the run.

## Commands

| Command | Exit | Notes |
|---|---|---|
| `pnpm check` | 0 | `tsc -b` clean, `eslint .` 0 problems, `vitest run` 9/9 |
| `pnpm build` | 0 | `dist/assets/index-*.js 375.73 kB (gzip 121.09 kB)`, `index-*.css 42.16 kB (gzip 17.89 kB)`, built in ~0.4 s |

## Issues found during testing

| Issue | Fix |
|---|---|
| First `pnpm check` failed: `ReferenceError: window is not defined` in `src/test-setup.ts` for the node-environment mock-server test | Guarded the `window.scrollTo` stub with `typeof window !== 'undefined'`; passed on next run |

No blockers.
