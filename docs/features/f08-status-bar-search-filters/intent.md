# F08 — Status Bar: Search, Counters, Filters · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Operators need to narrow 1 lakh vehicles down to the ones that matter, and find a specific vehicle instantly.

## What
- **Search:**
  - Prefix match (C11) on **VIN (`chasiss`)**, **regno** and **deviceid**.
  - A field selector, or "all fields".
  - A results dropdown shows the top matches. Choosing one jumps to the vehicle (F06 quick locate).
  - Pressing Enter applies the search as a filter on the map and table.
- **Status counters:**
  - One chip per status from F05: total, running, stopped, immobilized, non-comm, charging, pullout, no-gps, gps-never.
  - Each chip shows a live count. Clicking chips toggles status filters, and more than one can be selected.
- **Filter panel (C12):**
  - Fleet (a tree picker limited to permitted fleets).
  - Vehicle/asset type.
  - Fuel type.
  - SOC range.
  - Make / model.
  - Active filters appear as removable chips, with a "clear all" button.
- **Filters apply everywhere at once:** map markers, the table and the CSV export.
- **All matching happens in the worker.** The main thread sends only the filter definition.

## Done when
- Search results come back in ≤ 50 ms at 1 lakh vehicles.
- Counters match the filtered data.
- e2e tests cover search → jump, chip filters and combined filters.
