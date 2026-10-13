# F09 — Table View & CSV Export · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Some tasks are easier with a list than a map: scanning, sorting and exporting for offline work.

## What
- **Switching views:** a toggle swaps the map for a table view (the map is kept alive so returning is instant).
- **Scope toggle:**
  - **All:** every vehicle matching the current filters.
  - **Current viewport:** only matching vehicles inside the map bounds at the time of switching.
- **Columns:**
  - Regno, VIN, device ID, fleet, status, speed, SOC, DTE, ODO, ignition, last GPS time, last CAN time, location.
  - Columns are sortable.
  - You can show or hide columns.
- **Rendering:**
  - Rows are virtualised.
  - Sorting and windowing run in the worker, so the main thread only renders about 50 rows.
  - Values update live, with a pause toggle.
- **Row actions:** clicking a row opens the details panel (F07), and "locate" returns to the map at that vehicle.
- **Download CSV:**
  - Exports exactly what the table shows (scope + filters + visible columns), with timestamps in IST.
  - The CSV is generated in the worker and downloaded as a file named `fleet-vehicles-YYYYMMDD-HHmm.csv`.
  - The button shows only with `table.export`.

## Done when
- The table scrolls smoothly at 1 lakh rows.
- CSV export of 1 lakh rows completes in ≤ 5 s without freezing the UI.
- The CSV content matches the table in tests.

## Design note (2026-10-13, mockup v2)
- Adds a **vehicle tray** along the bottom of the map: glass cards for vehicles in the current viewport, showing regno, model · fleet, two key stats, a mini illustration and a status dot.
- It scrolls horizontally. Clicking a card selects that vehicle.
- It shares the worker's viewport query with the table's "current viewport" mode.
- These are confirmed in the F09 spec.
