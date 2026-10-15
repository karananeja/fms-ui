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

## Addendum — Widget previews in chat (D-135), client · 2026-10-15

| ID | Result | Evidence |
|---|---|---|
| P-T4 | Pass | `src/features/dashboards/widget-previews.test.tsx` (4): session `addWidget` (append without layout → server places; drop → breakpoint layout; already-added no-op; 24-widget limit rejects); dock card renders the widget, Add → dashboard PATCH + `PATCH …/previews/pv-1 {added}` + "Added ✓" (disabled); Ask to change pre-fills `Change the "<title>" preview: `; Discard → PATCH + hidden; stored added/discarded states come back from the thread; global panel picker (own dashboards + New dashboard) → PATCH + "Added ✓" + Open dashboard link |
| P-T5 | Pass | `e2e/dashboard-previews.spec.ts` (fake model, 1440 px): "add a small KPI of running vehicles" → card with live count, dashboard unchanged → Add → 2 grid items + "Added ✓"; second preview dragged (HTML5 DnD) to the right of row 0 → saved at `y = 0, x ≥ 6`; reload → 3 items, both cards `added` |
| P-T6 | Pass | same spec: global panel preview → Add to dashboard… → pick → widget on the dashboard (API) → Open dashboard → 2 grid items |

**Runs:** vitest assistant + dashboards 36/36; `tsc -b` + eslint clean; e2e `dashboard-previews` 2/2, `dashboard-builder` 1/1, `dashboards` 4/4 (+ setup), one run.

**Bundle:** `pnpm build` clean. The preview body (`preview-widget-body`, 0.6 kB) lazy-loads the shared `widget-renderer` chunk (23.1 kB); the panel side card + picker chunk is 24.5 kB (8.6 kB gz); `assistant-panel` 6.0 kB. A dist grep finds react-grid-layout code only in `dashboard-page-*.js` (102 kB, 30.2 kB gz).

## Addendum — Dashboard snapshots on list cards (D-142, `addendum-snapshots.md`) · 2026-10-16

| ID | Result | Evidence |
|---|---|---|
| S-T1 | Pass | `mock-server/tests/f20-snapshots.test.ts`: PUT → `DashboardSnapshot`; GET returns the same bytes, `content-type`, `x-snapshot-theme/captured-at`; HEAD headers only; a PNG replaces it |
| S-T2 | Pass | same: 120 KB OK, +1 byte → 413 `payload_too_large`, 3× → 413; text/plain and image/jpeg → 415; PNG bytes as webp → 422; theme `sepia` → 422 |
| S-T3 | Pass | same: stranger (not shared) 404; viewer role (no `dashboards.use`) 403; shared viewer PUT/GET their own, never the owner's |
| S-T4 | Pass | same: list items carry the caller's own `snapshot` (`null` otherwise) |
| S-T5 | Pass | same: revoke removes only the viewer's row; dashboard delete cascades |
| S-T6 | Pass | same: migration v9 `dashboard_snapshots` (contiguous with F25's v8); `wipeDatabase` empties the table |
| S-T7 | Pass | `src/features/dashboards/snapshot.test.tsx`: due rules (none/age/theme/changed), WebP quality loop 0.8→0.65→0.5 to ≤ 40 KB, PNG fallback, over-cap → null; age text; `gridReady`; registered map `toDataURL` freeze/restore |
| S-T8 | Pass | same: layout drawing until first capture; image blur-up (opacity 0 → 100 on load), "Snapshot · 5 min ago (other theme)" at 55 %; img error → drawing; list row without caption |
| S-T9 | Pass | `e2e/dashboard-snapshots.spec.ts`: open → PUT image/webp ≤ 40 KB → list card image 640×400 + "Snapshot · just now"; re-open within 10 min → no PUT |

**Runs:** vitest snapshot + f20-snapshots + f18 + f22 + database + rest-contract 40/40; eslint clean on touched files; `tsc -b` clean for these files (remaining errors are in F25/F26 in-progress files: `no-access-page`, `widget-queries`, `widget-renderer`, `catalogue-prompt`); e2e `dashboard-snapshots` 1/1, `dashboards` 4/4, `f23-chat-dashboard-ux` 8/8 (+ setup), `--workers=1`, one run.

**Bundle:** `vite build` clean. `modern-screenshot@4.7.0` lives only in `snapshot-capture-*.js` (23.6 kB, 9.1 kB gz), dynamically imported by `dashboard-page-*.js` (118.2 kB, 35.4 kB gz) only; `dashboards-page` 26.7 kB (8.8 kB gz); `app-entry` 345.5 kB (103.6 kB gz). Screenshot: `screenshots/f20-snapshot-card.png`.
