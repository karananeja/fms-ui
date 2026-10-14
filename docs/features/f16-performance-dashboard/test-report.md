# F16 — Test report

Branch `feature/f16-dashboard` (main checkout). Built by the orchestrator in session 8; testing kept light at the user's request. **Awaiting UAT.**

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (once) | **858/858**, typecheck + lint clean |
| `pnpm build` | pass; `analytics-page` lazy chunk **8.9 kB gzip** (budget 60 kB, no chart library) |
| `e2e/analytics.spec.ts` (setup + chromium) | **4/4** |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F16-T1 | pass | nice ticks, IST day boundary (18:30 UTC), en-IN numbers and compact axis labels (L/Cr); filters ↔ URL round-trip; custom window capped at 90 days; store: loads a view, aborts the replaced one, cache hits when switching back |
| F16-T2 | pass | tile value + "▲ 20.0%" delta; bar chart rects, keyboard tooltip, hidden table fallback, empty state |
| F16-T3 | pass | distance tile within 1 % of `GET /api/analytics/summary` (the page's window ends at load, the API default ends now); 7 d updates the URL (`range=7d`) and lowers the value; vehicle drill-down → "Open on the live map" → `/live-tracking?vehicle=` |
| F16-T4 | pass | drivers ranking sorted by score (desc); driver drill-down shows "Vehicles driven"; CSV export file name `fleet-analytics-drivers-<from>-<to>.csv` |
| F16-T5 | pass | Viewer: no Analytics nav, API 403. (The Operator-in-North cross-check is covered by F11's server tests; not repeated) |
| F16-T6 | not run | perf project not run (user asked to relax testing) |
| F16-T7 | pass | `screenshots/`: vehicles-tab, drivers-tab, drilldown-vehicle, mobile |
| F16-T8 | partial | check + build once; full e2e not run |

## Deviations
- **"View all" / CSV export are capped at 500 rows**: `/api/analytics/vehicles|drivers` take `limit ≤ 500` with no cursor (F11). So the CSV is always built on the main thread; the F09 worker path in the spec is never needed. The table scrolls inside its card (500 rows, not virtualised).
- Charts are one `DayChart` component (bars / lines / stacked areas) plus a `Sparkline`, rather than separate trend/bar files.
- Filters live in the route's search params (the URL is the source of truth); `AnalyticsStore` caches queries and aborts the replaced view.
- Range ids are `7d` / `30d` / `90d` / `custom` (TanStack Router quotes number-like strings in URLs).
- No default "top fleet": without a fleet the API uses the user's whole scope, which is the same thing for single-root users.
