# F26 — Dynamic Widgets (widget grammar) · Intent

**Status:** Signed off: 2026-10-15 (user chose Option A "widget grammar", then "approved"). Starts after F23.

## Why
The user wants to describe any fleet widget in plain words ("vehicles with battery under 20 % on a map, coloured by status", "breakdowns per fleet this week as a bar chart", "follow MH12AB1234 live") and have the assistant work it out on the fly. The fixed widget list (F18) can't express that.

## What
- **A new `custom` widget type** whose spec is a small declarative grammar. The AI composes it; it never writes code (D-116 still holds).
  1. **Data:** one allowed dataset:
     - `live-vehicles` (status, position, speed, SOC, fleet, make…, from the Web Worker);
     - `vehicle-history` (trail / metrics over time);
     - `analytics-series` and `analytics-ranking` (F16 KPIs);
     - `drivers`, `requests`, `notifications`.
     - Each dataset declares its fields, types and the permission it needs.
  2. **Shape:**
     - `filter` (field, op, value; and/or);
     - `groupBy`, `aggregate` (count/sum/avg/min/max);
     - `timeBucket` (hour/day/week);
     - `sort`, `limit` (top N);
     - time range (relative, IST).
  3. **Draw:** one mark:
     - `number`, `bar`, `line`, `area`, `pie`/`donut`, `table`, `gauge`, `heatmap`;
     - **`map`**: points coloured by a field, clusters, `follow` one vehicle, `trail` of the last N minutes, auto-fit.
     - Encodings: x / y / colour / size / label, plus format and units.
- **Safety and scope:**
  - The server validates every spec (zod): known fields only, type-correct ops, row and point limits.
  - Data is fetched **as the viewer**: worker queries for live data, existing endpoints for the rest. A shared dashboard never shows out-of-scope vehicles.
  - Unknown fields or not-permitted datasets → a clear error the model can fix (fed back, as in F19).
- **Rendering:**
  - One in-house renderer, built on the F16 SVG charts, the F20 table and MapLibre for maps (no new dependency). It is theme-aware (DS3) and lazy-loaded in the dashboard chunk.
  - **Limits:** at most 3 map marks per dashboard; live data at most 1 Hz; maps off-screen pause.
- **Assistant:**
  - The catalogue prompt gains the grammar, generated from the contract, with examples.
  - Single-widget requests still arrive as **preview cards** (D-135), so the user sees the result before adding it.
  - "Change it to a line chart" edits the spec.
  - Fake-model rules cover e2e.
- **The existing 8 widget types stay** as they are.

## Out of scope
- AI-written code or HTML (Option B).
- Joins across datasets.
- Free-form formulas beyond the listed aggregates.
- Geofences and route playback.
- Writing data.

## Done when
- e2e with the fake model, each built from a prompt → preview → add, and each persisting after a reload:
  - a live map of low-battery vehicles coloured by status (markers update as data changes);
  - a follow-one-vehicle map with a trail;
  - a bar chart of breakdowns per fleet over 7 days;
  - a top-10 table.
- A scope test: a viewer with fewer fleets sees fewer points or rows on the same dashboard.
- Validation tests reject unknown fields, bad ops and over-limit specs with fixable errors.
- The live-tracking map's perf budgets are unchanged with a dashboard of 3 maps open in another tab.
