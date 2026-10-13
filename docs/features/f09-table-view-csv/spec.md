# F09 — Table View, CSV Export & Vehicle Tray · Spec

| Field | Value |
|---|---|
| Status | **Awaiting sign-off** |
| Intent | `intent.md` (signed off 2026-10-13, plus the mockup v2 design note for the vehicle tray) |
| Visual source of truth | `docs/design/design-direction.html` v2 for the vehicle tray, glass panels and type. The table follows the same tokens. |
| Branch / delivery | `feature/f09-table-csv`, **in parallel with F08** from the shared filter-contract commit (F08 spec §5) |

## 1. Files (kebab-case)
```
src/features/live-tracking/
  worker/table-query.ts           sort + window over matching vehicles (all / bbox scope)
  worker/csv-exporter.ts          RFC 4180 CSV from matching rows → Blob chunks
  worker/tray-query.ts            vehicles in viewport for the tray
  config/table-columns.ts         column ids, labels, accessors, formatters, default visibility
  components/table-view.tsx       TanStack Table + TanStack Virtual (thin)
  components/table-toolbar.tsx    scope toggle, column menu, pause, export, back-to-map
  components/vehicle-tray.tsx     bottom glass card strip on the map
```
New dependencies: `@tanstack/react-table` and `@tanstack/react-virtual`.

## 2. Requirements

### View switching
| ID | Requirement |
|---|---|
| F09-R1 | The table button in the map tool stack (DS1) and `?view=table` in the URL both switch to the table. The **map stays mounted underneath**, hidden, so returning to it is instant. "Back to map" and the map button return. Selecting a vehicle (`?vehicle=`) works in both views, and the details card floats over the table on the right. |
| F09-R2 | **Scope toggle:**<br>• **All:** every vehicle matching the current filter.<br>• **Viewport:** matching vehicles inside the map bbox, captured when switching to the table.<br>• The current scope and count show in the toolbar, e.g. "VIEWPORT · 2,431 VEHICLES". |

### Worker
| ID | Requirement |
|---|---|
| F09-R3 | `queryTable({scope, bbox?, sort: {column, dir}, offset, limit})` returns `{total, rows, version}`.<br>• Rows are plain objects for the visible window only: `limit` ≤ 200; the UI asks for the visible range + 50 buffer.<br>• Sorting uses a cached index that is re-sorted when data or the sort changes, at most every 1 s while live.<br>• **Iterates only `filters.matches(i)`** (F08 contract). |
| F09-R4 | **Live updates:** the table re-queries its window at the push cadence (≤ 4 Hz). A **Pause** toggle freezes the window, showing a "Paused" badge and the number of updates waiting. |
| F09-R5 | `exportCsv({scope, bbox?, sort, columns})`:<br>• Builds the CSV in the worker in chunks, keeping the worker responsive (yields every 10 000 rows).<br>• Returns a `Blob`. The main thread downloads it as `fleet-vehicles-YYYYMMDD-HHmm.csv`, in IST.<br>• **Columns, order, sort, scope and filter match the table exactly.**<br>• Timestamps use `formatIst`, and numbers are not grouped.<br>• Values are RFC 4180 quoted.<br>• A toast shows progress and the finished row count. |
| F09-R6 | `getTray({bbox, limit: 24})`: matching vehicles in the bbox, ordered by status priority, then most recently updated. It returns the card fields only. |

### UI
| ID | Requirement |
|---|---|
| F09-R7 | **Columns** (`table-columns.ts`):<br>• Regno, VIN, Device ID, Fleet (name), Status (pill), Speed, SOC, DTE, ODO, Ignition, Last GPS (IST + relative on hover), Last CAN, Location (lat, lng).<br>• Sortable headers.<br>• A column menu shows or hides columns; choices are remembered in localStorage.<br>• Numeric columns are right-aligned, and the sticky first column is Regno. |
| F09-R8 | **Table look:** a glass container, Doto, a sticky header with uppercase muted labels, a 40 px row height, a row hover tint, and the selected row in `--accent-soft`. Virtualised, so only about 50 rows are in the DOM. |
| F09-R9 | **Row actions:**<br>• Clicking a row selects it (the details card opens).<br>• The row's "Locate" icon switches to the map and calls `store.locateVehicle`. |
| F09-R10 | **Export button:** shown only with the `table.export` permission, and disabled while an export is running. |
| F09-R11 | **Vehicle tray** (desktop, on the map, bottom, left of the details card; collapsible, collapsed state remembered):<br>• Up to 24 glass cards from `getTray(viewport)`, refreshed with the map frame.<br>• Each card shows regno (shortened in the middle if long), `MODEL · FLEET`, a status dot, two stats chosen by status (running: speed + SOC; charging: SOC + DTE; otherwise: SOC + DTE) and a mini `vehicle-illustration` (F07).<br>• Horizontal scroll. Clicking a card selects that vehicle, and the selected card is highlighted with the teal ring.<br>• Hidden on mobile. |
| F09-R12 | **Mobile (< 1024 px):** the table shows Regno, Status and SOC by default. Other columns can be turned on in the column menu, and the table scrolls horizontally. |

## 3. Budgets
- Table scrolling at 1 lakh rows: no long task > 50 ms; window query ≤ 30 ms in the worker.
- CSV export of 1 lakh rows ≤ 5 s, with no main-thread long task > 50 ms during it.
- Tray query ≤ 10 ms.

## 4. Acceptance tests
| ID | Type | Test |
|---|---|---|
| F09-T1 | unit | `table-query`: sorting on each column type (both directions, stable), windowing, all vs bbox scope, only matching rows (stub `matches`), and version bumps. |
| F09-T2 | unit | `csv-exporter`: header + rows equal the table for the same scope/sort/columns; RFC 4180 quoting (commas, quotes, newlines); IST timestamps; row count. |
| F09-T3 | perf | 100 000 vehicles: query ≤ 30 ms, export ≤ 5 s, tray ≤ 10 ms. The times are reported. |
| F09-T4 | unit | `tray-query`: bbox, ordering and limit. |
| F09-T5 | component | Table renders a virtual window. Sort clicks call the store. The column menu persists. Pause freezes and counts updates. Export is hidden without the permission. |
| F09-T6 | e2e | Map → table → map keeps the map camera. `?view=table` deep-links. Viewport scope count ≤ All count. Clicking a row opens the card, and Locate returns to the map at zoom 16. |
| F09-T7 | e2e | Scrolling 1 lakh rows causes no long task > 50 ms. Export downloads a file whose row count equals the table total and whose header equals the visible columns. |
| F09-T8 | e2e | The tray shows cards for the viewport. Clicking one selects that vehicle, and the tray updates after panning. |
| F09-T9 | e2e | Screenshots for UAT, saved to `docs/features/f09-table-view-csv/screenshots/`: the table view (desktop), the column menu, export in progress, the map with the tray, and the mobile table. |
| F09-T10 | cmd | `pnpm check` and `pnpm build` pass, plus e2e with `--project=chromium --project=clock --no-deps`. Perf is run once by the orchestrator after merging. |

## 5. Contract with F08
F09 uses `filters.matches(i)` and `filters.version` only. Until F08 merges, the contract stub matches everything; tests stub `matches` to cover filtering.

## 6. Out of scope
- Server-side export and export formats other than CSV.
- Editing data from the table.
