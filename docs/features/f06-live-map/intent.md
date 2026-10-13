# F06 — Live Map · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
The map is the primary view: where every vehicle is, and what state it is in, at a glance.

## What
- **The map itself:**
  - MapLibre GL with dark OSM vector tiles.
  - Initial view is India.
  - Standard zoom controls and a scale bar.
- **Markers:**
  - Vehicle markers are coloured by status and rotated by heading.
  - Clusters are drawn when zoomed out, with a count and a status breakdown ring.
  - Clicking a cluster zooms into it.
- **Rendering split:** the worker returns clusters and points only for the current viewport and zoom. The map draws them through a GeoJSON or WebGL layer, with no DOM markers.
- **Zoom to fit:**
  - Automatic, once, when the first fleet batch arrives (C13).
  - Also available as a button that fits all vehicles matching the current filters.
- **City dropdown:** a list of major Indian cities. Selecting one pans the map to that city's bounds. It does not filter (C14).
- **Quick locate:** searching for or selecting a vehicle flies to it and opens the detail panel. The map does not keep following the vehicle (C15).
- **Interaction:** hovering a marker shows a tooltip with regno and status. Clicking a marker selects it, which opens F07.

## Out of scope
- Trail history on the main map. It is shown only on the share page (F10).
- Geofences.

## Done when
- Panning and zooming stay at ≥ 50 fps with 1 lakh vehicles on a mid-range laptop.
- e2e tests pass for fit, city jump and locate.
