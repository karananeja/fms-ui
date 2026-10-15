# F26 — Dynamic Widgets (widget grammar) · Spec

**Status:** Draft — written with the signed-off intent (2026-10-16).
**Scope:** contract (`custom` widget type + grammar), assistant (catalogue prompt, tools, fake rules), worker (`queryWidgets` custom kind), dashboard renderer. No new dependency (MapLibre already in the app, lazy-loaded in the dashboard chunk).

## 1. Widget

A new catalogue entry `{ id, type: 'custom', title, spec }`. The 8 F18 types are unchanged. `spec` is pure data; the assistant composes it, never code (D-116).

```ts
spec = {
  data:  { dataset, filter?, range?, minutes?, vehicle?, fleetId?, driverId?, entity? },
  shape?: { groupBy?, timeBucket?, aggregate?, sort?, limit? },
  mark:  { type, x?, y?, color?, size?, label?, columns?, format?, unit?, max?,
           cluster?, follow?, trailMinutes?, fit? },
}
filter = { all?: Cond[], any?: Cond[] }            // every `all` and ≥ 1 `any`; ≤ 8 conditions
Cond   = { field, op, value }                       // value: string | number | (string|number)[] ≤ 20
```

## 2. Datasets (`shared/contract/widget-grammar.ts`, `DATASETS`)

| Dataset | Source (as the viewer) | Permission | Fields (type) | Params |
|---|---|---|---|---|
| `live-vehicles` | Web Worker `queryWidgets` (≤ 1 Hz) | `live.view` | vehicleId, regno (string); fleet (fleet); status (enum F05); make, model, assetType, fuelType (string); ignition (enum on/off); speed km/h, soc %, dte km, odometer km, heading ° (number); gpstime (time); lat, lng (number) | — |
| `vehicle-history` | `GET /api/vehicles/:id/trail?minutes=` | `vehicle.details.view` | time (time), lat, lng (number) | `vehicle` (required regno/id), `minutes` 5–1440 (60) |
| `analytics-series` | `GET /api/analytics/series` | `analytics.view` | day (time), 12 KPI fields (number) | `range`, `fleetId`/`vehicle`/`driverId` |
| `analytics-ranking` | `GET /api/analytics/vehicles|drivers` (top 500 by the sorted / aggregated KPI) | `analytics.view` | vehicleId, regno (vehicles); driverId, name, score (drivers); fleet; 12 KPI fields | `entity` vehicles (default) / drivers, `range`, `fleetId` |
| `drivers` | `GET /api/drivers?limit=500` | `drivers.manage` | driverId, name, phone (string); fleet; status (enum); createdAt (time) | `fleetId` |
| `requests` | `GET /api/requests?limit=500` | `requests.manage` | requestId, vehicleId, driverId (string); fleet; type, status, reason (enum); createdAt, updatedAt (time) | `range` (on createdAt), `fleetId` |
| `notifications` | `GET /api/notifications?limit=200` | — | kind, severity (enum); title (string); fleet; vehicleId; read (enum yes/no); createdAt (time) | `range` |

Field types: `string`, `enum` (fixed values), `fleet` (fleet id; the tools resolve names), `number`, `time` (epoch ms, shown in IST). `range` defaults to `7d`. Data is always fetched with the viewer's session, so a shared dashboard shows each viewer only their fleets (the worker holds only the viewer's vehicles; REST endpoints scope by session).

## 3. Shape (applied in order: filter → group → aggregate → sort → limit)

- **filter ops:** `eq ne in nin` on every field; `lt lte gt gte` on number; `contains` on string. Values must match the field type; enum values must be valid. Time fields are filtered with `data.range` only.
- **groupBy:** a string/enum/fleet field. **timeBucket:** `hour | day | week` (IST) on the dataset's time field (`analytics-series` day/week only). Both together = 2-D (heatmap / series per group).
- **aggregate:** `{ op: count|sum|avg|min|max, field? }` (field numeric, required unless `count`). Default `count` when grouped.
- **sort:** `{ by: <field> | 'value', dir }`. **limit:** 1–50 rows / groups (default 50 rows, 12 groups).

## 4. Marks and encodings

| Mark | Needs | Encodings |
|---|---|---|
| `number`, `gauge` | no grouping (aggregate or row count) | `format`, `unit`; gauge `max` (default 100) |
| `bar` | groupBy or timeBucket | `color` = second dimension (series) |
| `line`, `area` | timeBucket | `color` = groupBy (≤ 6 series) |
| `pie`, `donut` | groupBy | — |
| `heatmap` | groupBy + timeBucket | — |
| `table` | rows: `columns` (1–8 fields); grouped: key + value | `format`, `unit` |
| `map` | dataset `live-vehicles` or `vehicle-history`; no grouping | `color` (enum/string field; status uses status colours), `label`, `cluster`, `fit` (default true), `follow` (live-vehicles + an `all` condition `regno|vehicleId eq …`), `trailMinutes` 5–240 (follow only; history trail + live positions) |

`format`: `number | percent | duration | distance | datetime`; `unit` ≤ 12 chars.

## 5. Limits & safety

- zod validates every spec in the store (`dashboardContentSchema`, create/update bodies, previews): unknown dataset/field, wrong-type op or value, mark/shape mismatch, over-limit sizes → 422 with a path and a fixable message ("Unknown field "battery" for live-vehicles. Use one of: …").
- **≤ 3 map marks per dashboard** (content refine). Map points ≤ 2 000 per widget (worker caps; footer "2,000 of N"). Rows/groups ≤ 50.
- Permission: `widgetPermission(custom)` = the dataset's permission (store `widget_not_permitted` as F18).
- Live data ≤ 1 Hz (the F20 page poller); maps pause off-screen (IntersectionObserver: unregister the live query) and while the tab is hidden.

## 6. Worker API

`LiveWidgetQuery` gains `{ kind: 'custom', filter?, groupBy?, timeBucket?, aggregate?, sort?, limit?, columns?, points? }`; result `{ kind: 'custom', total, value?, groups?, rows?, points? }`. It runs in `WidgetQueryEngine` with its own predicate (never the global filter/viewport/selection/table/tray), cached per (query, data version) like F20. The shaping core (`shared/domain/widget-shape.ts`) is shared with the client, which applies it to REST rows. Budget: 3 custom queries over 1 lakh vehicles ≤ 15 ms p95; F20-T4 budget unchanged.

## 7. Renderer (`src/features/dashboards/widgets/custom/`)

`CustomWidget` → `useCustomData` (live: worker query; REST: page `QueryCache` + `applyShape`) → mark components: `NumberMark`, `GaugeMark`, `CategoryChart` (bars/line/area on in-house SVG with F16 scale helpers), `DayChart` (F16) for day buckets, `PieMark`, `HeatmapMark`, `TableMark` (F20 table styling), `MapMark` (lazy `import('./map-controller')` → MapLibre GeoJSON source with built-in clustering, status colours, follow + trail line, theme-aware basemap). Same §6.1 states (loading, empty, no-access, error).

## 8. Assistant

- Catalogue prompt gains a `custom` section generated from `DATASETS`, ops, marks and limits, with 4 examples (low-battery map, follow map, breakdowns per fleet, top-10 table). Deterministic; the F24 prompt snapshot is updated intentionally.
- Guidance: prefer the fixed types when they fit; single widgets still go through `preview_widget` (D-135); "change it to a line chart" → `preview_widget`/`update_widget` with the edited spec; to follow a vehicle the user must name it — otherwise ask which vehicle.
- Tools resolve `data.vehicle`, `data.fleetId`, `data.driverId` and `fleet` condition values (names → ids) and `regno` follow targets in the user's scope; failures are returned to the model as fixable tool errors.
- **Fake rules** (e2e): "battery … map" → low-battery map coloured by status; "track / follow … live" with a regno → follow map with a 30-min trail, without → "Which vehicle should I follow?"; "breakdowns per fleet" → bar chart (analytics-ranking, sum breakdowns by fleet, 7d); "top 10 … table" → top-10 speed table; "change … line chart" → the breakdowns spec as a line by day.

## 9. Acceptance tests

| ID | Test | Where |
|---|---|---|
| F26-T1 | Grammar: examples valid; unknown field / bad op / bad enum value / mark mismatch / follow without a vehicle / > 3 maps / limits rejected with fixable messages | vitest `widget-grammar.test.ts` |
| F26-T2 | Shape core: filter all/any, groupBy, timeBucket (IST), aggregates, sort, limit | vitest `widget-shape.test.ts` |
| F26-T3 | Worker custom query: rows, groups, points (cap), follow, cached per version, global filter untouched | vitest `widget-query.test.ts` |
| F26-T4 | Perf: 3 custom queries at 1 lakh ≤ 15 ms p95 (F20-T4 unchanged) | vitest perf |
| F26-T5 | Tools: custom preview resolves names, permission per dataset, invalid spec → tool error; prompt contains the grammar | vitest `dashboard-tools.test.ts` |
| F26-T6 | e2e: low-battery map (preview → add → markers update → reload persists) | `e2e/f26-dynamic-widgets.spec.ts` |
| F26-T7 | e2e: follow-one-vehicle map with trail; without a regno the assistant asks which vehicle | e2e |
| F26-T8 | e2e: breakdowns per fleet bar (7d) and change to a line chart; top-10 table; all persist after reload | e2e |
| F26-T9 | e2e scope: the same dashboard shared with a North operator shows fewer rows | e2e |
| F26-T10 | Live map perf spec unchanged (the worker changed) | `live-map.perf.spec.ts` |

## 10. Decisions to propose

| ID | Decision |
|---|---|
| D-144 | `custom` widget = declarative grammar (dataset → shape → mark) validated by zod in the contract; one shaping core shared by worker and client; no code or HTML from the model. |
| D-145 | Datasets use existing endpoints/worker only, fetched as the viewer; ranking-based groupings use the top 500 rows of the endpoint (noted in the widget footer when truncated). |
| D-146 | Map marks: MapLibre GeoJSON + built-in clustering, lazy-loaded in the dashboard chunk; ≤ 3 per dashboard, ≤ 2 000 points, paused off-screen; follow = live position + REST trail. |
