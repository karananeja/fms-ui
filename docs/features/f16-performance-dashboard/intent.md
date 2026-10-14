# F16 — Performance Dashboard · Intent

**Status:** Signed off: 2026-10-14 (user)

## Why
Fleet operators want to analyse how vehicles and drivers perform over time, not only where they are now.

## What
- **Dashboard** (`/analytics`, `analytics.view`), scoped to the user's fleets. Filters: fleet, date range (7 / 30 / 90 days, custom), vehicle or driver.
- **Vehicle KPIs:**
  - distance;
  - uptime / downtime;
  - idle time;
  - number of breakdowns;
  - time in no-GPS;
  - energy (SOC) use per km;
  - charging sessions.
- **Driver KPIs:**
  - distance;
  - driving hours;
  - idle time;
  - harsh braking and acceleration;
  - overspeed events;
  - breakdowns reported;
  - a simple score.
- **Views:** KPI tiles, trend charts, top/bottom rankings, and per-vehicle / per-driver drill-down. Export as CSV (reuses F09).
- **Charts** need a chart library, so a decision entry (new dependency) is needed in the spec. Heavy aggregation happens in the mock server.

## Out of scope
Custom report builder, scheduled report emails.

## Done when
KPIs match the mock's generated history (contract tests). The dashboard loads within budget for the largest fleet. e2e covers filters, drill-down and export.
