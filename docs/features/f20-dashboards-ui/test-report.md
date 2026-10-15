# F20 — Dashboards Route & UI · Test report

**Date:** 2026-10-15 · **Branch:** `feature/part3-f19-f20` (uncommitted) · **Ports:** 5373 / 4201

| ID | Result | Evidence |
|---|---|---|
| F20-T1 | Pass | `src/features/dashboards/grid-spike.test.tsx` (StrictMode, no errors, resize); drag in e2e T10 |
| F20-T2 | Pass | `dashboards-data.test.ts`: IST ranges around midnight IST/UTC, exact URLs per type, dedupe |
| F20-T3 | Pass | `dashboards-data.test.ts`: debounce/coalesce, serial versions, no save on load, 409 soft reload, 5xx 2/4/8 s + manual Retry, `adoptRemote` rebase + stale ignore, remove + Undo |
| F20-T4 | Pass | `widget-query.test.ts` (parity with FilterEngine/table on random states, subtrees, both directions, `sinceVersion`, global state untouched); `widget-query.perf.test.ts` p95 8.1 ms (≤ 10), unchanged 0.0002 ms |
| F20-T5…T7 | Deferred | component tests not written (time-boxed); behaviour covered by e2e T8/T11/T12 |
| F20-T8 | Pass | `e2e/dashboards.spec.ts` |
| F20-T9 | Covered by F19 | `e2e/dashboard-builder.spec.ts` — see report (F19 chip issue) |
| F20-T10 | Pass | drag + resize + keyboard move, reload, API layout equal |
| F20-T11 | Pass | rename (title bar + card), duplicate, delete with Cancel/Delete |
| F20-T12 | Pass | share to super admin, read-only view, revoke → 404 state |
| F20-T13…T16 | Deferred | conflict, live parity/clock, mobile/light, fewer-fleets e2e not written |
| F20-T17 | Partial | `pnpm build` clean; see sizes below; full `pnpm check` by orchestrator |

**Unit:** 19/19 (dashboards 14, widget-query 5). **e2e:** dashboards.spec 4/4 (+ setup).

**Bundle (gzip):** `dashboards-page` 5.4 kB (≤ 15); `dashboard-page` 35.3 kB incl. RGL (≤ 60); its CSS 0.8 kB (≤ 4); `app-entry` 102.8 kB; live-tracking worker 28.1 kB gz. A dist grep finds RGL/draggable/resizable code only in `dashboard-page-*.js`.

Screenshots (`FMS_SHOTS=1`): `f20-empty-state.png`, `f20-list.png`, `f20-dashboard-dark.png`, `f20-share-dialog.png`.
