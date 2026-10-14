# F16 — Performance Dashboard · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server contract | F11: `GET /api/analytics/summary\|vehicles\|drivers\|series` (IST days, ≤ 90 days, fleet-scoped, `analytics.view`). **No mock changes.** |
| Charts | **No chart library.** Small in-house SVG components, following the F07 `session-chart.tsx` approach (D-103). Alternative if rejected: `uplot` (≈ 50 kB, needs a dependency decision). |
| Visual source of truth | **New screen: look proposed in §4, confirmed by UAT screenshots.** DS1 dark tokens + Doto. |
| Delivery | One agent in the main checkout, branch `feature/f16-analytics`, ports 5273/4101, decisions **D-103…D-104**. After F13/F14. |

## 1. Files (kebab-case)
```
src/features/analytics/api/analytics-api.ts
src/features/analytics/analytics-store.ts             class-based: filters (URL-synced), cached queries, abort on change
src/features/analytics/pages/analytics-page.tsx       /analytics (lazy chunk)
src/features/analytics/components/kpi-tiles.tsx
src/features/analytics/components/trend-chart.tsx     line/area, multi-series, hover crosshair + tooltip, keyboard focusable
src/features/analytics/components/bar-chart.tsx       vertical bars (daily) and horizontal (rankings)
src/features/analytics/components/sparkline.tsx
src/features/analytics/components/ranking-table.tsx   top/bottom N, virtualised for "all"
src/features/analytics/components/entity-drilldown.tsx  vehicle or driver detail sheet
src/features/analytics/lib/chart-scale.ts             nice ticks, IST day axis, number formats (en-IN)
src/app/router.tsx, nav-items.ts                       /analytics + "Analytics" nav item (analytics.view)
```

## 2. Requirements
| ID | Requirement |
|---|---|
| F16-R1 | **Filters** (synced to the URL, so views can be shared): fleet (F03 picker, in scope), range (7 / 30 / 90 days, custom ≤ 90 days, IST), and an optional vehicle or driver focus. The default is the user's top fleet over the last 30 days. Changing a filter aborts in-flight requests. |
| F16-R2 | **Vehicles tab:** KPI tiles (distance, uptime %, idle %, breakdowns, no-GPS hours, energy per km, charge sessions), each with the change vs the previous period. **Charts:** daily distance (bars), uptime vs downtime (stacked area), and no-GPS hours (line). **Ranking:** top/bottom 10 by a chosen KPI, plus "View all" (virtualised). |
| F16-R3 | **Drivers tab:** KPI tiles (distance, driving hours, idle %, harsh braking/acceleration per 100 km, overspeed events, breakdowns reported, average score). **Charts:** score trend and events per 100 km. **Ranking** by score (best/worst 10). |
| F16-R4 | **Drill-down:** clicking a ranking row or a vehicle/driver focus opens a detail sheet with that entity's tiles and daily charts. The vehicle sheet links to the live map (`/live-tracking?vehicle=`); the driver sheet shows the vehicles driven in the range. |
| F16-R5 | **Export:** "Export CSV" of the current tab's ranking (all rows) plus the daily series. CSV is built from the API response on the main thread for ≤ 5 k rows; larger exports go through the existing F09 worker exporter. File name: `fleet-analytics-<tab>-<from>-<to>.csv`. |
| F16-R6 | **Charts:** SVG and responsive. IST date axis with nice ticks and en-IN number formats. Hover or keyboard focus shows a tooltip. Each chart has an accessible table fallback (a visually hidden `<table>`). Colours use DS1 tokens, with status colours for status-type series. Empty or zero-data states are explicit. |
| F16-R7 | **Permissions:** `analytics.view` for the page and nav; data stays within the user's fleet scope (server-enforced). |

## 3. Budgets
- Root fleet over 30 days: tiles + charts rendered within 1.5 s of navigation on the mock (server ≤ 500 ms per F11). One fleet over 90 days ≤ 800 ms.
- A filter change has no long task > 50 ms. The page chunk is ≤ 60 kB gzip (no chart library).

## 4. Look (proposal, confirmed via UAT screenshots)
- Dark DS1. A filter bar at the top, then a 4-column tile grid (2 columns on mobile), then charts in glass cards (2 per row on desktop, stacked on mobile), then the ranking table.
- Tiles: big Doto number + unit, a small delta pill (ok/danger tint) and a sparkline.
- Charts: the teal accent for the main series and muted lines for comparison, with a thin grid.

## 5. Tests
| ID | Type | Test |
|---|---|---|
| F16-T1 | unit | `chart-scale`: nice ticks, IST day boundaries, en-IN formats. `analytics-store`: URL sync, abort on change, cache hit. |
| F16-T2 | component | Tiles show deltas; charts render paths for given data, the tooltip on hover/focus, the accessible table fallback, and the empty state. |
| F16-T3 | e2e | Super admin → `/analytics` → tiles match `GET /api/analytics/summary` for the same filters. Changing the range and fleet updates the URL and data. Drill-down into a vehicle → its link opens the live map. |
| F16-T4 | e2e | The drivers tab ranking sorted by score; the driver drill-down lists the vehicles driven. CSV export: header and row count match the ranking. |
| F16-T5 | e2e | A Viewer has no Analytics nav/route. An Operator in North only sees North data (an API cross-check). |
| F16-T6 | perf | §3 budgets (root fleet, 30 days), run in the perf project. |
| F16-T7 | e2e | UAT screenshots → `screenshots/`: vehicles tab, drivers tab, drill-down sheet, mobile. |
| F16-T8 | cmd | `pnpm check`, `pnpm build`, e2e (setup + chromium, then clock) once at the end. |

## 6. Decisions to propose
- **D-103:** in-house SVG charts, no chart library.
- **D-104:** the analytics filters are URL-synced and the export path (main thread ≤ 5 k rows, F09 worker above).

## 7. Out of scope
Custom report builder, scheduled emails, comparing two fleets side by side, real-time (intra-day) analytics.
