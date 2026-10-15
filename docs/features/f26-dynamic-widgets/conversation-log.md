# F26 — Dynamic Widgets · Conversation log

## 2026-10-16 — spec + implementation (agent)

**User (via orchestrator):** "Implement F26 Dynamic Widgets (widget grammar) … first write spec.md, then implement. Example the user cares about most: 'create a widget with vehicle on the map tracking its location and movement in live mode' → follow-one-vehicle map with a trail (ask which vehicle if none named)."

**Assistant:**
- Wrote `spec.md` (Draft): grammar (dataset → shape → mark), 7 datasets with fields/permissions, ops, marks/encodings, limits, worker API, renderer, prompt section, fake rules, F26-T1…T10, proposed D-144…D-146.
- Contract: `shared/contract/widget-grammar.ts` (DATASETS, zod schema + `customSpecIssues` fixable messages, limits); `custom` type in the catalogue; per-dataset `widgetPermission`; ≤ 3 map widgets per dashboard.
- Shaping core `shared/domain/widget-shape.ts`, shared by the worker (`widget-custom-query.ts`, new `custom` kind of `queryWidgets`, own predicate) and the client (REST rows).
- Renderer `src/features/dashboards/widgets/custom/**`: number, gauge, bar/line/area (in-house SVG), pie/donut, heatmap, table, map (MapLibre lazy-loaded, GeoJSON clusters, status colours, follow + trail, snapshot registration, off-screen pause).
- Assistant: generated grammar section in the catalogue prompt (5 examples), tools resolve names/regnos and return fixable errors, fake rules for the four e2e widgets, the line-chart edit and the "which vehicle?" question; F24 snapshot updated.

**Status/Next:** Implemented and tested (see `test-report.md`). Awaiting UAT; D-144…D-146 proposed (not yet in `decision-log.md`).
