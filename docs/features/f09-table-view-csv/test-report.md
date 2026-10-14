# F09 — Test report

Branch `feature/f09-table-csv` (worktree `../fms-ui-f09`, ports 5373/4200). **Ready for UAT.** Not merged; nothing here is accepted until UAT. The perf project as a whole is run by the orchestrator after merging.

## Final runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass — **366/366** tests, 33 files, 0 lint warnings |
| `pnpm build` | pass; main chunk 651.4 kB (203.5 kB gzip), live-tracking worker 69.7 kB; leak scan of `dist/` for `__fmsMap`, `__fmsLive`, `dev-session`: none |
| `playwright test --project=chromium --project=clock --no-deps` | **24/24** pass (incl. 5 new F09 specs) |
| `playwright test e2e/table-view.perf.spec.ts --project=perf --no-deps` (single run) | pass — see Budgets |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F09-T1 table-query | pass | `worker/table-query.test.ts`: each column type both directions (stable), windowing, all vs bbox, only `matches(i)`, version bumps |
| F09-T2 csv-exporter | pass | same file: header + rows = table for scope/sort/columns, RFC 4180 quoting, IST timestamps, row count |
| F09-T3 perf (node, 1 lakh) | pass | sort/cache build 5.5–28.2 ms (regno 25.7, fleet 24.9, status 11.2, soc 20.9, gpstime 5.5, location 28.2); window 0.05–0.21 ms; viewport sort 1.9 ms; export 100 000 × 13 cols 0.55 s (12.4 MB); tray 0.87–2.41 ms |
| F09-T4 tray-query | pass | bbox, status priority then recency, limit |
| F09-T5 components | pass | `components/table-view.test.tsx`: virtual window, sort → store, column menu persists, pause counts updates, export hidden without `table.export` |
| F09-T6 e2e | pass | `e2e/table-view.spec.ts`: map → table → map keeps centre/zoom exactly; `?view=table` deep-links; Pune viewport count < All (1,00,000); row click → `?vehicle=` + details card over the table + row `aria-selected`; Locate → map at zoom 16, vehicle selected |
| F09-T7 e2e | pass | wheel + scrollbar-style jumps through 1 lakh rows; last row (`aria-rowindex` 100001) loads; < 80 rows in the DOM. Export with VIN hidden: file `fleet-vehicles-YYYYMMDD-HHmm.csv`, header = visible column labels, record count (RFC 4180 parse) = table total, "Exported 1,00,000 rows" toast |
| F09-T8 e2e | pass | Pune: 1–24 tray cards; clicking one selects it (ring, `aria-pressed`, details card) and the vehicle lies in the map bounds; after a pan the card set changes |
| F09-T9 screenshots | done | `screenshots/`: `table-desktop.png` (with a selected row + card), `column-menu.png`, `export-in-progress.png` (CPU throttled ×6 to catch the toast), `map-with-tray.png`, `mobile-table.png` (390 px: Regno, Status, SOC; no tray) |
| F09-T10 | pass | rows above |

## Budgets (spec §3)
| Budget | Measured | Verdict |
|---|---|---|
| Window query ≤ 30 ms (worker) | 0.05–0.21 ms (node, T3) | pass |
| Table scroll at 1 lakh: no long task > 50 ms | browser (`table-view.perf`): longest 50 ms (one task, exactly at the limit); before the fix 55–86 ms | pass, **no headroom** in dev mode |
| CSV export of 1 lakh ≤ 5 s | 584 ms browser end-to-end (0.55 s node) | pass |
| No main-thread long task > 50 ms during export | none | pass |
| Tray query ≤ 10 ms | ≤ 2.41 ms (node, T3) | pass |

Browser numbers are from the Vite dev server (React development build), like the other perf specs; production renders are cheaper.

## Bugs found and fixed during F09 verification
- **Scroll long tasks (55–86 ms)** while wheel-scrolling 1 lakh rows: every scroll event re-rendered every row synchronously (TanStack Virtual `flushSync`) and each time cell ran its own 30 s timer. Rows are now a memoised component with stable callbacks, `useFlushSync: false`, and the relative-time tooltip is computed on hover — `86eddff`.
- **Locate unclickable with a vehicle selected**: the details card covered the Actions column (and clipped Export CSV). The table now ends beside the card and the toolbar wraps (D-068, Proposed).
- **Tray showed fleet ids instead of names** when its first `/api/fleets` call raced the dev sign-in (401) and was never retried — now retried with the frames until names load.
- Heading compass floated over the table header — hidden in table view.
- Cells clipped text without an ellipsis (truncate on a flex container); the sticky Regno cell did not take the hover/selected tint.
- Tray stats wrapped ("77 / km") — kept on one line.

## Open items
- D-068 and D-069 are Proposed and need approval.
- Scroll budget has no headroom in the dev build (50 ms max in the single perf run); the orchestrator's post-merge perf run should confirm.

## Post-merge verification (integration/f08-f09, 2026-10-14)
`pnpm check` 440/440; `pnpm build` clean, no dev leaks; e2e chromium + clock 29/29; full perf project 5/5 (load avg 3.5):
F04-T9 first data 1136 ms / snapshot 1487 ms; F04-T10 3.26 pushes/s, 0 streaming long tasks; F06-T9 0 long tasks;
F08 frame after filter change 25–118 ms, no long tasks; F09 scroll no long tasks, export 678 ms, no long tasks.
Integration changes: D-074. UAT accepted 2026-10-14.

## Hardening: scroll headroom and T9 export step (fix/f09-table-scroll, 2026-10-14)
After F02 merged, two F09 e2e checks failed under machine load (load avg ~7) and passed alone: F09-T7 scroll long tasks 54 and 74 ms, and the F09-T9 desktop "export in progress" step timing out on "Exported N rows".

**Scroll cause (CPU profile + Chrome trace of `scrollTable`):** the cost was React rendering rows, not the worker (window query ≤ 0.2 ms). Each wheel step (1 200 px = 30 rows) or scrollbar jump mounts a whole window of new rows, and every window response or live push re-rendered **every** row: TanStack's row model created new `Row` objects, which defeated `memo`. Each cell also went through `flexRender` + `getContext` + a `<Cell>` component + fragments; in the dev build each element costs a `jsxDEV` debug stack (≈ 45 % of self time).

**Fix (`table-view.tsx`, no behaviour change):** rows render straight from the worker window (TanStack Table still drives the header); `VehicleRow` is memoised on the row's field values, so responses and pushes only re-render rows that entered or changed; cell content is a plain function returning strings where possible (one element per cell instead of four); overscan 8 → 4 (≈ 31 → 23 rows in the DOM, still "about 50" max).

**Before/after, longest main-thread tasks during `scrollTable` (Chrome trace `RunTask`, dev build, load avg 4–8, 3 runs each):**
| | top tasks (ms) |
|---|---|
| before | 48 / 41 / 39 · 51 / 50 / 49 · 52 / 51 / 48 |
| after | 24 / 22 / 21 · 23 / 22 / 21 · 26 / 25 / 21 |

**T9 export step:** under load the 6×-throttled screenshot could outlast the export plus the success toast's 4 s auto-dismiss, so the 30 s wait for "Exported N rows" never saw it. The test now records toast texts with a `MutationObserver` before clicking, resets throttling in a `finally` right after the screenshot, waits for the CSV `download` (60 s), and then asserts an "Exported N rows" toast appeared. Same assertions, no timing dependence.

Verification (load avg 6–10): `pnpm check` 521/521; e2e setup + chromium 36/36; perf `e2e/table-view.perf.spec.ts` 2 runs: scroll no long tasks, export 581 / 540 ms with no long tasks. Decision: D-079 (Proposed).
