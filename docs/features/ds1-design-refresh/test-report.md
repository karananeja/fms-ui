# DS1 — Design Refresh · Test report

Date: 2026-10-13 · Branch `feature/ds1-design-refresh` · Ports `VITE_PORT=5273 MOCK_PORT=4100`

| ID | Result | Evidence |
|---|---|---|
| DS1-T1 | Pass | `src/shared/styles/theme-tokens.node.test.ts`: scans every `src/**/*.{ts,tsx,css}` (except `theme.css` and tests) for hex/rgb/hsl/oklch literals — none; `STATUS_META` tokens resolve to the spec's 8 status colours. |
| DS1-T2 | Pass | Same unit test: no `Inter` in `package.json` or sources, `--font-sans` starts with Doto; `dist/` has no Inter asset. e2e `design-refresh.spec.ts` DS1-T2: computed `font-family` of body, button, input, cluster marker and attribution starts with `Doto`; `document.fonts` has no Inter. |
| DS1-T3 | Pass | All F00/F04/F05/F06 e2e pass. Selector change: `.maplibregl-ctrl-zoom-in` → `getByRole('button', { name: 'Zoom in' })` (F06-T10; NavigationControl replaced). `live-connection` test id moved to the LIVE pill (same text). Perf budgets **not run** here (orchestrator runs `perf` after merge). |
| DS1-T4 | Pass | `screenshots/desktop-clusters.png`, `desktop-zoom15-selection.png`, `desktop-3d.png`, `mobile-390.png` (offline blank e2e style, so no base-map tiles/buildings). |
| DS1-T5 | Pass | `pnpm check` (typecheck, lint, 249 unit tests) ✓; `pnpm build` ✓; `pnpm e2e --project=chromium --no-deps` 14/14 ✓; `pnpm e2e --project=clock --no-deps` 1/1 ✓. |

Commands:
```
pnpm check && pnpm build
VITE_PORT=5273 MOCK_PORT=4100 pnpm e2e --project=chromium --no-deps
VITE_PORT=5273 MOCK_PORT=4100 pnpm e2e --project=clock --no-deps
```
(`--no-deps` because `clock` depends on `perf`, which is skipped for DS1.)

Deviations / notes:
- DS1-R12 (trail) not implemented — reassigned to F07.
- DS1-R9 toasts: the store's notice has no success/error kind, so toasts use glass with a teal accent edge; `--danger` styling will apply once a notice kind exists.
- DS1-R10 buildings are only visible on the real OpenFreeMap style; the e2e blank style degrades to pitch only (verified by the 3D test).
- F06-T6 is timing-sensitive (cluster rebuild after auto-fit): it failed when the new DS1 spec's tests ran fully parallel to it, and 1/4 on the baseline with `--repeat-each=4`. The DS1 spec is configured `serial`; full suite then passes.
- `playwright.config.ts` has a pre-existing Prettier warning from c5efa27; left untouched.
