# F08 — Test report

Branch `feature/f08-search-filters` (worktree `../fms-ui-f08`, ports 5273/4100). **Ready for UAT; all budgets pass after D-072 + D-073.** Not merged; nothing here is accepted until UAT.

## Final runs (2026-10-14, after D-072 + D-073)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass — **406/406** tests, 36 files, 0 lint warnings (tsc also caught the perf spec's `longtask` observer typing, fixed) |
| `pnpm build` | pass; main chunk 594.5 kB (188.0 kB gzip), worker 71.1 kB; leak scan of `dist/` for `__fmsMap`, `__fmsLive`, `dev-session`: none |
| `playwright test --project=chromium --project=clock --no-deps` | **24/24** pass (incl. 5 new F08 specs) |
| `playwright test e2e/status-bar.perf.spec.ts --project=perf --no-deps` (×2, `VITE_PORT=5273 MOCK_PORT=4100`) | **pass** both runs — see Budgets |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F08-T1 filter-engine | pass (21) | `worker/filter-engine.test.ts`: each field, OR within / AND across, fleet subtrees, counts without statuses, live status, version, random insert/update/remove vs reference, growth regression |
| F08-T2 search-index | pass (5 + 4) | `worker/search-index.test.ts`, `worker/fleet-state-hooks.test.ts` (identifier change, add/remove) |
| F08-T3 perf (node, 1 lakh) | pass | apply ≤ 9.3 ms (statuses 0.0, fleet subtree 2.1, types+make+model 3.7, SOC 2.0, search-all 9.3, everything 4.9); counts 4.2 ms; search index full build 73 ms (off the query path, D-066); query after add 0.09 / remove 0.00 / id change 0.03 / 500 adds 0.05 ms; warm ≤ 0.03 ms |
| F08-T4 map-index mask | pass (11) | `worker/map-index-filter.test.ts`: clusters/points, zoom-16 scan, bounds, rebuild inside the 2 s throttle, filtered push counts, `selectedMatches`, filter options; D-072: status-only change keeps the index (counts/breakdown of selected statuses, empty clusters dropped, zoom-16 scan, null bounds), cached unfiltered index served then rebuilt, forced update without an excursion still rebuilds (D-063), engine: status change → frame without build, Clear all → cache hit then rebuild; D-073: filter change pushes at once, window restarts, data alone ≤ 4 Hz |
| F08-T5 store | pass (5) | `store/live-tracking-store.test.ts` F08-T5 block: toggleStatus, patch/normalise/clear, fleets → worker, filtered counts + hidden selection, pulse 10 s / 1 h / restart on new scope |
| F08-T6 components | pass (12) | `components/status-bar.test.tsx`: search keyboard flow + ARIA, `/`, empty hint; pills toggle/ALL, `fitCount`, compact mobile counts; panel → filter (fleet subtree, make→model), mobile sheet; chips remove/Clear all; pulse card |
| F08-T7 e2e | pass | suggestions → locate at zoom 16; Enter → `Any: …` chip, ALL drops, fewer framed vehicles |
| F08-T8 e2e | pass | RUNNING + CHARGING (via `+N` at 1280 px) = ALL; zoom-to-fit frames the filtered set (±2 %, live statuses); Clear all restores the total |
| F08-T9 e2e | pass | fleet + SOC 20–60 % → chips, `Filters (2 active)`, pulse scope = fleet name, ALL drops; 390 px: pills scroll, panel is a sheet with Apply in view |
| F08-T10 screenshots | done | `screenshots/`: `top-bar-suggestions.png`, `fleet-pulse.png` (2 real samples), `filter-panel.png`, `active-chips.png`, `mobile.png`, `mobile-filters.png` |
| F08-T11 | pass | rows above |

## Budgets (spec §3) — browser, 1 lakh vehicles, `e2e/status-bar.perf.spec.ts`
After D-072 + D-073; load average 8.7 / 8.6 (F09 finished). History: before D-072 + STOPPED 197/254, ALL 265/275, Clear all 314/297 ms; after D-072 alone the frame cost ≤ 1 ms in the worker but changes waited up to ~250 ms for the 4 Hz push slot (248–257 ms rows), which D-073 removes.

| Budget | Run 1 | Run 2 | Verdict |
|---|---|---|---|
| Suggestions ≤ 50 ms (worker) | ≤ 0.1 ms | — | pass (node, T3) |
| Filter apply ≤ 100 ms (worker) | ≤ 9.3 ms | — | pass (node, T3) |
| Next map frame ≤ 200 ms — RUNNING on | 81 ms | 57 ms | pass |
| — + STOPPED (≈ 68 k vehicles) | 71 ms | 48 ms | pass |
| — ALL (back to 1 lakh) | 97 ms | 73 ms | pass |
| — search prefix (Enter) | 25 ms | 25 ms | pass |
| — Clear all (back to 1 lakh) | 50 ms | 47 ms | pass |
| No main-thread long task > 50 ms while typing/filtering | none | none | pass |

## Bugs found and fixed during F08
- Filter missed rows added after `FleetState` growth (captured column arrays) — `9dfa05b`.
- Search index went stale on identifier changes; first query after any add/remove took 75 ms — D-065, D-066.
- Search box: after choosing a suggestion, the stale list and highlight survived, so the next Enter located the old vehicle instead of filtering — fixed (reset on choose/apply/edit).
- Overlays (suggestions, filter popover, `+N`) were translucent over the map/pulse card — now `surface-solid`.
- Mobile top row overflowed (LIVE pill clipped) — search flexes, LIVE pill is compact on mobile, placeholder "Search vehicles".
