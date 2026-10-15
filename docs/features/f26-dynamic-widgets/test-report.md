# F26 — Dynamic Widgets · Test report

**Date:** 2026-10-16 · **Branch:** `feature/f22-persist-admin-data` (shared checkout, not committed) · **Ports:** VITE 5473 / MOCK 4301

| ID | Test | Result |
|---|---|---|
| F26-T1 | `shared/contract/widget-grammar.test.ts`: documented specs valid; unknown field, wrong op, bad enum value, list/scalar mismatch, mark ↔ shape mismatch, follow without a vehicle, wrong params, limits, extra keys rejected with fixable messages; dataset permissions; `CUSTOM_RANGES = TIME_RANGES`; 4th map rejected | Pass |
| F26-T2 | `shared/domain/widget-shape.test.ts`: all/any filters, contains/ne, top-K sort (missing last), count/sum/avg/min/max, IST hour/day/week buckets, gap fill, 2-D groups | Pass |
| F26-T3 | `worker/widget-custom-query.test.ts`: rows (fleet subtree, sort, columns), groups, points (valid positions, colour, cap), follow by regno, cached per data version | Pass |
| F26-T4 | `worker/widget-query.perf.test.ts` at 1 lakh: F20-T4 p95 7.5 ms (budget 10, unchanged); 3 custom queries p95 7.4 ms (budget 15) | Pass (alone; fails only under a parallel full-suite load) |
| F26-T5 | `mock-server/assistant/dashboard-tools.test.ts`: prompt carries datasets/marks/rules; examples valid; preview resolves fleet names and follow regnos; bad spec / unknown vehicle / dataset permission → tool errors | Pass (11/11) |
| F26-T6 | e2e low-battery map: prompt → preview (points) → Add → `data-updates` increases (live) → reload persists | Pass |
| F26-T7/T8 | e2e top-10 table (10 rows), breakdowns per fleet bar → "change it to a line chart" → line, follow map asks for the vehicle first, then follows the table's top regno with a trail (`data-trail` > 1); all 4 persist after reload | Pass |
| F26-T9 | e2e scope: dashboard shared with ops (North) shows a smaller live total than the super admin's | Pass |
| F26-T10 | `live-map.perf.spec.ts` (F06-T9): 0 long tasks, p95 frame 50 ms | Pass |

Also run: `dashboard-previews.spec.ts` (P-T5/P-T6) pass; `analytics.spec.ts` pass; `shared/contract/dashboards.test.ts` pass (custom sample added); F24 prompt snapshot updated intentionally (`-t "match the snapshot"`).

**Notes**
- `tsc -b` clean; eslint on F26 files: 0 errors (4 fast-refresh warnings, same kind as `widget-renderer.tsx`).
- Not caused by F26, seen while other agents were editing: `f19-*` / most `f24` server tests return 500 (`ctx.hub?.dashboardEvent is not a function`, F27 work in progress); `theme-tokens` flags `lib/snapshot-capture.ts` (snapshot work); e2e runs occasionally get 401 when `tsx watch` restarts the in-memory mock after another agent's edit (re-run passes).
- The simulator keeps SOC ≥ ~20 %, so the e2e map uses "under 40 %" (the prompt example keeps 20 %).
- "3 maps open in another tab" was not run as a dedicated scenario: hidden tabs stop the live poller (F20) and off-screen maps unregister their query; the worker cost of custom queries is covered by F26-T4.

Screenshots: `screenshots/f26-t6-low-battery-map.png`, `screenshots/f26-t8-built.png`.
