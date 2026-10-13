# F06 — Live Map · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Branch | `feature/f06-live-map` |
| Builds on | F04 (worker/store), F05 (status column + `STATUS_META`) |

## 1. Files (kebab-case)

```
src/features/live-tracking/
  config/map-config.ts               India default view, cluster radius/max zoom, caps, fit padding, fly zoom
  config/india-cities.ts             city list for the dropdown (name, state, bbox)
  worker/map-index.ts                supercluster index + live point queries + bounds
  components/live-map.tsx            MapLibre container (thin; delegates to map-controller)
  components/map-controller.ts       imperative MapLibre wiring: sources, layers, events (no business logic)
  components/cluster-marker.tsx      SVG donut for cluster breakdown
  components/map-toolbar.tsx         zoom-to-fit button, city dropdown
  components/debug-overlay.tsx       the F04/F05 diagnostics, moved into a collapsible overlay (?debug=1)
public/map-styles/blank-dark.json    offline style for tests (background only)
```
New dependencies: `maplibre-gl` and `supercluster` (+ types).

## 2. Requirements

### Map & page
| ID | Requirement |
|---|---|
| F06-R1 | `/live-tracking` renders a full-bleed map in the content area. Layers above it: the toolbar at top right, MapLibre zoom (+/−) controls, a scale bar at bottom left, and **OSM attribution, which must always be visible** (an OpenStreetMap licence requirement). |
| F06-R2 | The style comes from `VITE_MAP_STYLE_URL` (OpenFreeMap dark, D-020). The e2e tests set it to `/map-styles/blank-dark.json`, so tests never depend on an external tile server. |
| F06-R3 | **Initial view:** India, `fitBounds([[68.1, 6.5], [97.4, 35.7]])`. |
| F06-R4 | **No WebGL:** if WebGL is unavailable, show a clear message in place of the map. The rest of the page keeps working. |
| F06-R5 | **Diagnostics panel:** the F04/F05 panel moves into a collapsible `debug-overlay`, shown only with `?debug=1`. It keeps a "Locate vehicle ID" input for UAT. |

### Worker map index (`map-index.ts`)
| ID | Requirement |
|---|---|
| F06-R6 | **Clustering:** use supercluster over all vehicles in the fleet state, `radius: 60`, `maxZoom: 14`. `map`/`reduce` keep a per-status count array (8 values) for each cluster. |
| F06-R7 | **Rebuilds:** the index is rebuilt at most once per `clusterRebuildMs` (default 2000), only when positions, statuses or membership changed. The rebuild runs in the worker, and its duration is shown in `stats.clusterBuildMs`. |
| F06-R8 | **Zoom ≥ 15 (unclustered):** points come from a **direct bounding-box scan of live state**, not from the index. That keeps close-up positions current between rebuilds. |
| F06-R9 | **Frame payload.** `setViewport({bbox, zoom})` returns a `MapFrame` as **transferable typed arrays**:<br>• `points`: `lng`/`lat` (Float64), `heading` (Float32), `status` (Uint8), `ids` and `regnos` (string[]).<br>• `clusters`: `lng`/`lat`, `id`, `count`, and `breakdown` (Uint32, count × 8).<br>• A `version`.<br>At most `maxFramePoints` (5000) points are sent. If more would be visible, clustering is forced for that frame. |
| F06-R10 | **Live refresh:** after the viewport is set, the worker recomputes the frame whenever the data changes. It sends it as `push.mapFrame` (transferred), within the existing ≤ 4 Hz push cadence. |
| F06-R11 | **Helper queries:**<br>• `getClusterExpansionZoom(clusterId)`.<br>• `getBounds()` returns the bbox of all vehicles with a valid position (gps-never excluded), or null. F08 will narrow this to the filtered set.<br>• `getVehicleSummary(id)` (F04) supplies the quick-locate position. |

### Rendering (`map-controller.ts`)
| ID | Requirement |
|---|---|
| F06-R12 | **Vehicle points:**<br>• A GeoJSON source fed from the frame, drawn as a `symbol` layer.<br>• The icon is an SDF arrow: `icon-color` comes from the status colour and `icon-rotate` from the heading.<br>• Statuses that aren't moving (stopped, non-comm, gps-never, and so on) use an SDF dot instead.<br>• Colours are resolved once from `STATUS_META` CSS variables using `getComputedStyle` (F05 note). |
| F06-R13 | **Clusters:**<br>• Clusters are DOM markers (`cluster-marker.tsx`): an SVG donut showing the status breakdown, with the count in the centre (Indian grouping, `1.2k`/`12k` shortened). There are only a few hundred clusters at most, so DOM markers are fine.<br>• Markers are reused across frames by cluster id, not recreated.<br>• Clicking a cluster runs `easeTo(expansionZoom)` centred on the cluster. |
| F06-R14 | **Points:** hovering shows a tooltip with regno and status label. Clicking calls `store.selectVehicle(id)`. The selected vehicle gets a highlight ring, which follows the selected payload's live position. |
| F06-R15 | **Viewport:** `moveend` (debounced 100 ms) calls `store.setViewport`. Nothing is sent during an active pan, so the main thread stays free while dragging. |

### Actions
| ID | Requirement |
|---|---|
| F06-R16 | **Automatic zoom to fit:** happens **once**, on the first `snapshotComplete`. It uses `fitBounds(getBounds(), {padding: 48, maxZoom: 14})`. It does not happen after a reconnect. |
| F06-R17 | **Zoom-to-fit button:** the toolbar button runs the same fit on demand. It is disabled while there are no vehicles. If the bounds are a single point, it flies there at zoom 14 instead. |
| F06-R18 | **City dropdown:**<br>• A searchable dropdown of the 40 cities in `india-cities.ts`, matching the mock generator's city centres, sorted A–Z.<br>• Selecting a city fits its bbox.<br>• It **does not filter** (C14). Selecting resets the dropdown label to "Jump to city…". |
| F06-R19 | **Quick locate:**<br>• `store.locateVehicle(id)` selects the vehicle and `flyTo`s its current position at zoom 16 (duration 1 s), then stops. There is no follow (C15).<br>• If the vehicle has no valid position, a toast says "No location available".<br>• Callers: a point click (select only, no fly), the debug input now, and F07's locate button and F08 search later. |

### Store additions
| ID | Requirement |
|---|---|
| F06-R20 | `LiveTrackingStore` gains:<br>• `setViewport`, `locateVehicle`, `fitToVehicles`.<br>• `mapFrame` in the state.<br>• A `mapCommands` event channel (fit / fly / ease) that `map-controller` subscribes to. Business decisions stay in the store, and the controller only executes them.<br>There are still no React imports in the store. |
| F06-R21 | Dev only: `window.__fmsMap` exposes `{center, zoom, bounds, frameVersion, clusterCount, pointCount, autoFitDone}` for e2e tests. |

## 3. Budgets
- Panning and zooming stay at ≥ 50 fps with 1 lakh vehicles on a mid-range laptop. **This is verified manually at UAT on real hardware.** Headless Chromium renders WebGL in software, so fps measured there doesn't mean much.
- No main-thread long task > 50 ms during a scripted pan/zoom (automated).
- A frame for any viewport at 1 lakh arrives in ≤ 100 ms after `setViewport`.
- A cluster rebuild at 1 lakh takes ≤ 500 ms in the worker; the measured time is reported.

## 4. Acceptance tests

| ID | Type | Test |
|---|---|---|
| F06-T1 | unit | `map-index` with synthetic vehicles:<br>• At zoom 4 over India, cluster and point counts add up to the total, excluding gps-never.<br>• Each cluster's status breakdown adds up to its count.<br>• The zoom ≥ 15 bbox scan returns only points inside the box.<br>• The `maxFramePoints` cap forces clustering. |
| F06-T2 | unit | Rebuilds are throttled to at most 1 per `clusterRebuildMs`. A position update shows up in a zoom-15 frame immediately, without waiting for a rebuild. |
| F06-T3 | unit | `getBounds` leaves out gps-never and returns null when empty. `getClusterExpansionZoom` gives a zoom greater than the current one. |
| F06-T4 | unit | Store: `setViewport` → frame; `locateVehicle` sends a select plus a fly command, or a toast when there is no position; `fitToVehicles` sends a fit, or a fly for a single point. Auto-fit happens only once, including after a reconnect. |
| F06-T5 | perf | `map-index` at 100 000 vehicles: rebuild ≤ 500 ms, frame ≤ 100 ms. Both are reported. |
| F06-T6 | e2e | On load: the India view, then a single auto-fit once the snapshot completes (`autoFitDone`). Panning away and waiting 5 s causes no re-fit. |
| F06-T7 | e2e | The zoom-to-fit button refits. Choosing "Pune" from the city dropdown puts the map centre within the Pune bbox. |
| F06-T8 | e2e | Clicking a cluster increases the zoom. Clicking a point sets `selectedVehicleId` and shows the highlight. Debug "Locate vehicle ID" reaches zoom 16 with the centre ≤ 100 m from that vehicle. |
| F06-T9 | e2e perf | A scripted 10 s of pans and zooms at 1 lakh vehicles produces no long task > 50 ms. The test also reports rAF frame times, for information only. |
| F06-T10 | e2e | At 390 px wide, the map, toolbar and attribution are visible and usable. |
| F06-T11 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. Existing F04/F05 e2e tests are updated for the move into the debug overlay. |

## 5. Out of scope
- Detail panel (F07), search, counters and filters (F08), table (F09).
- Trails, geofences, satellite layers.
