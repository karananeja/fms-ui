import {
  KPI_FIELDS,
  KPI_METRICS,
  LIST_LIMIT_MAX,
  TEXT_NOTE_MAX,
  TIME_RANGES,
  VEHICLE_LIST_COLUMNS,
  WIDGET_PERMISSIONS,
  WIDGET_SIZES,
  WIDGET_TITLE_MAX,
  WIDGET_TYPES,
  WIDGETS_PER_DASHBOARD,
  DRIVER_STATUSES,
  REQUEST_TYPES,
  widgetToolInputSchema,
  AGGREGATE_OPS,
  CUSTOM_COLUMNS_MAX,
  CUSTOM_CONDITIONS_MAX,
  CUSTOM_GROUPS_MAX,
  CUSTOM_RANGES,
  CUSTOM_ROWS_MAX,
  DATASET_IDS,
  DATASETS,
  FIELD_TYPES,
  MAP_MARKS_PER_DASHBOARD,
  MAP_POINTS_MAX,
  MARK_TYPES,
  OPS_BY_TYPE,
  TIME_BUCKETS,
  VALUE_FORMATS,
  type FieldDef,
  type WidgetToolInput,
  type WidgetType,
} from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { z } from 'zod';

/**
 * F19 §4: the "Dashboard widget catalogue" section of the system prompt, generated at module
 * load from the contract (types, fields, enum values, limits, permissions, sizes). Deterministic:
 * no ids, no dates. A contract change updates the prompt and the caching snapshot test flags it.
 */

const HINTS: Record<WidgetType, string> = {
  kpi: 'one big number: a live status count (source "live") or a KPI over a time range (source "analytics")',
  'daily-chart': 'day-by-day trend of 1–3 KPIs as bars, a line or an area',
  'status-breakdown': 'current vehicles per status, as bars or a donut',
  ranking: 'top/bottom N vehicles or drivers by a KPI over a time range',
  'vehicle-list': 'a live table of vehicles filtered by status, fleet, make, fuel type and SOC',
  'driver-list': 'drivers filtered by status, fleet or a name fragment',
  'requests-summary': 'driver requests (breakdown, replacement, RSA) as counts or the latest ones',
  text: 'a markdown note (headings, explanations, links)',
  custom:
    'anything the fixed types cannot show: a declarative spec (dataset → shape → mark), e.g. a live map, a per-fleet chart, a heatmap or a custom table',
};

/** F26: the grammar examples shown in the prompt (checked by the tests). */
export const CUSTOM_EXAMPLES: { ask: string; widget: WidgetToolInput }[] = [
  {
    ask: 'vehicles with battery under 20 % on a map, coloured by status',
    widget: {
      type: 'custom',
      title: 'Low-battery vehicles',
      spec: {
        data: { dataset: 'live-vehicles', filter: { all: [{ field: 'soc', op: 'lt', value: 20 }] } },
        mark: { type: 'map', color: 'status', cluster: true },
      },
    },
  },
  {
    ask: 'follow MH12AB1234 live on a map with its movement',
    widget: {
      type: 'custom',
      title: 'Tracking MH12AB1234',
      spec: {
        data: {
          dataset: 'live-vehicles',
          filter: { all: [{ field: 'regno', op: 'eq', value: 'MH12AB1234' }] },
        },
        mark: { type: 'map', follow: true, trailMinutes: 30, label: 'regno' },
      },
    },
  },
  {
    ask: 'breakdowns per fleet this week as a bar chart',
    widget: {
      type: 'custom',
      title: 'Breakdowns per fleet (7 days)',
      spec: {
        data: { dataset: 'analytics-ranking', range: '7d' },
        shape: {
          groupBy: 'fleet',
          aggregate: { op: 'sum', field: 'breakdowns' },
          sort: { by: 'value', dir: 'desc' },
          limit: 10,
        },
        mark: { type: 'bar' },
      },
    },
  },
  {
    ask: 'top 10 fastest running vehicles as a table',
    widget: {
      type: 'custom',
      title: 'Top 10 fastest vehicles',
      spec: {
        data: {
          dataset: 'live-vehicles',
          filter: { all: [{ field: 'status', op: 'eq', value: 'running' }] },
        },
        shape: { sort: { by: 'speed', dir: 'desc' }, limit: 10 },
        mark: { type: 'table', columns: ['regno', 'fleet', 'speed', 'soc'] },
      },
    },
  },
  {
    ask: 'requests per day by type, last 30 days',
    widget: {
      type: 'custom',
      title: 'Requests per day',
      spec: {
        data: { dataset: 'requests', range: '30d' },
        shape: { groupBy: 'type', timeBucket: 'day' },
        mark: { type: 'line' },
      },
    },
  },
];

function fieldText(name: string, f: FieldDef): string {
  const type = f.values ? `${f.type}(${f.values.join('|')})` : f.type;
  const extra = [f.unit, f.entity && `${f.entity} only`].filter(Boolean).join(', ');
  return `${name} ${type}${extra ? ` [${extra}]` : ''}`;
}

/** F26: the `custom` section, generated from `DATASETS` and the grammar constants. */
function customSection(): string {
  const size = WIDGET_SIZES.custom;
  return [
    '### custom',
    `Use it for: ${HINTS.custom}. Prefer a fixed type when one fits exactly.`,
    '- fields: title; spec: { data; shape?; mark } (the grammar below; the model never writes code)',
    "- needs permission: the dataset's (below)",
    `- grid size (12 columns): default ${size.w}×${size.h}, minimum ${size.minW}×${size.minH}`,
    '#### Datasets (spec.data.dataset) — always read as the viewer, so each viewer sees only their fleets',
    ...DATASET_IDS.map((id) => {
      const d = DATASETS[id];
      return `- ${id} (${d.permission ?? 'any user'}): ${d.summary}. Params: ${d.params.join(', ') || 'none'}.${d.timeField ? ` Time field: ${d.timeField}.` : ''} Fields: ${Object.entries(d.fields)
        .map(([n, f]) => fieldText(n, f))
        .join('; ')}.`;
    }),
    '#### spec.data',
    `{ dataset; filter?: { all?: [cond], any?: [cond] } (1–${CUSTOM_CONDITIONS_MAX} each; a row must match every "all" and at least one "any"); range?: ${CUSTOM_RANGES.join(' | ')} (default 7d, IST); minutes?: 5–1440 (vehicle-history, default 60); vehicle?: regno or id; fleetId?: fleet name or id; driverId?: driver name or id; entity?: vehicles | drivers (analytics-ranking) }`,
    `cond = { field; op; value }. Ops by field type: ${FIELD_TYPES.filter((t) => t !== 'time')
      .map((t) => `${t}: ${OPS_BY_TYPE[t].join(' ')}`)
      .join('; ')}. "in"/"nin" take a list (≤ 20), the others one value; numbers for number fields, strings otherwise; enum values must be listed ones; fleet values take a fleet name. Time fields are filtered only with data.range.`,
    '#### spec.shape (optional; filter → group → aggregate → sort → limit)',
    `{ groupBy?: a string/enum/fleet field; timeBucket?: ${TIME_BUCKETS.join(' | ')} (IST, on the time field); aggregate?: { op: ${AGGREGATE_OPS.join(' | ')}; field?: a number field (required unless count) } (default count when grouped); sort?: { by: a field or "value"; dir: asc | desc }; limit?: 1–${CUSTOM_ROWS_MAX} (≤ ${CUSTOM_GROUPS_MAX} groups) }`,
    '#### spec.mark',
    `{ type: ${MARK_TYPES.join(' | ')}; x?; y?; color?; size?; label?: field names; columns?: 1–${CUSTOM_COLUMNS_MAX} fields (table); format?: ${VALUE_FORMATS.join(' | ')}; unit?: ≤ 12 chars; max?: number (gauge); cluster?, follow?, fit?: boolean; trailMinutes?: 5–240 (map) }`,
    '- number / gauge: one value (aggregate, or the row count); no groupBy/timeBucket.',
    '- bar: groupBy and/or timeBucket (a second dimension becomes series), or rows with x (category) + y (number).',
    '- line / area: timeBucket (groupBy → one series each, ≤ 6), or rows with x (a time field) + y (number).',
    '- pie / donut: groupBy only. heatmap: groupBy (rows) + timeBucket (columns).',
    '- table: rows with columns, or grouped results (key + value).',
    '- map: dataset live-vehicles (points; color = a string/enum/fleet field, status uses status colours; size = a number field; cluster for many points) or vehicle-history (a trail). follow: true tracks ONE vehicle and needs data.filter.all [{ field: "regno", op: "eq", value: "<regno>" }]; trailMinutes adds its recent path. To follow or track a vehicle the user must name it — if they did not, ask which vehicle instead of calling a tool.',
    `Limits: ≤ ${MAP_MARKS_PER_DASHBOARD} map widgets per dashboard; ≤ ${MAP_POINTS_MAX} points per map; live data refreshes once a second. Unknown fields, wrong ops or a mark that does not fit the shape are rejected with a message that says how to fix the spec.`,
    'Edits: "change it to a line chart" keeps the data and shape and changes the mark (preview_widget again for a preview, update_widget for a widget on the dashboard).',
    'Examples:',
    ...CUSTOM_EXAMPLES.map((e) => `- "${e.ask}": ${JSON.stringify(e.widget)}`),
  ].join('\n');
}

/** One valid example input per type (checked by the tests). */
export const CATALOGUE_EXAMPLES: Record<WidgetType, WidgetToolInput> = {
  kpi: { type: 'kpi', title: 'Running now', source: 'live', status: 'running' },
  'daily-chart': {
    type: 'daily-chart',
    title: 'Distance per day',
    chart: 'bar',
    metrics: ['distanceKm'],
    range: '30d',
  },
  'status-breakdown': { type: 'status-breakdown', title: 'Fleet status', display: 'donut' },
  ranking: {
    type: 'ranking',
    title: 'Top idle vehicles',
    entity: 'vehicles',
    metric: 'idleMs',
    order: 'desc',
    limit: 10,
    range: '7d',
  },
  'vehicle-list': {
    type: 'vehicle-list',
    title: 'Vehicles without GPS',
    filter: { statuses: ['no-gps'] },
    columns: ['regno', 'fleet', 'status', 'gpstime'],
    sort: { column: 'gpstime', dir: 'asc' },
    limit: 20,
  },
  'driver-list': { type: 'driver-list', title: 'Active drivers', status: 'active', limit: 20 },
  'requests-summary': {
    type: 'requests-summary',
    title: 'Open requests',
    groupBy: 'type',
    openOnly: true,
    display: 'counts',
    limit: 10,
  },
  text: { type: 'text', title: 'Notes', body: '## Shift notes\nCheck no-GPS vehicles first.' },
  custom: {
    type: 'custom',
    title: 'Low-battery vehicles',
    spec: {
      data: { dataset: 'live-vehicles', filter: { all: [{ field: 'soc', op: 'lt', value: 20 }] } },
      mark: { type: 'map', color: 'status', cluster: true },
    },
  },
};

type Json = Record<string, unknown>;

/** A compact one-line rendering of a JSON-schema property. */
function render(s: Json): string {
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map(String).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  const alt = (s.anyOf ?? s.oneOf) as Json[] | undefined;
  if (alt) return alt.map(render).join(' | ');
  switch (s.type) {
    case 'array': {
      const n =
        s.minItems !== undefined || s.maxItems !== undefined
          ? ` (${String(s.minItems ?? 0)}–${String(s.maxItems ?? '')} items)`
          : '';
      return `[${render(s.items as Json)}]${n}`;
    }
    case 'object':
      return `{ ${fields(s).join('; ')} }`;
    case 'integer':
    case 'number': {
      const range =
        s.minimum !== undefined || s.maximum !== undefined
          ? ` ${String(s.minimum ?? '')}–${String(s.maximum ?? '')}`
          : '';
      return `${String(s.type)}${range}`;
    }
    case 'string':
      return s.maxLength !== undefined ? `string (≤ ${String(s.maxLength)} chars)` : 'string';
    default:
      return String(s.type ?? 'any');
  }
}

function fields(s: Json): string[] {
  const props = (s.properties ?? {}) as Record<string, Json>;
  const required = new Set((s.required ?? []) as string[]);
  return Object.entries(props)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${render(v)}`);
}

/** The JSON-schema variants of one widget type (kpi and ranking have two). */
function variants(type: WidgetType): Json[] {
  const root = z.toJSONSchema(widgetToolInputSchema, {
    reused: 'inline',
    unrepresentable: 'any',
  }) as Json;
  const flat: Json[] = [];
  const walk = (s: Json) => {
    const alt = (s.anyOf ?? s.oneOf) as Json[] | undefined;
    if (alt) alt.forEach(walk);
    else flat.push(s);
  };
  walk(root);
  return flat.filter(
    (s) => ((s.properties as Record<string, Json> | undefined)?.type?.const as string) === type,
  );
}

function section(type: WidgetType): string {
  if (type === 'custom') return customSection();
  const size = WIDGET_SIZES[type];
  const perm =
    type === 'kpi'
      ? 'live.view for source "live", analytics.view for source "analytics"'
      : (WIDGET_PERMISSIONS[type] ?? 'none');
  return [
    `### ${type}`,
    `Use it for: ${HINTS[type]}.`,
    ...variants(type).map((v) => `- fields: ${fields(v).join('; ')}`),
    `- needs permission: ${perm}`,
    `- grid size (12 columns): default ${size.w}×${size.h}, minimum ${size.minW}×${size.minH}`,
    `- example: ${JSON.stringify(CATALOGUE_EXAMPLES[type])}`,
  ].join('\n');
}

export const CATALOGUE_PROMPT = [
  '## Dashboard widget catalogue',
  `A dashboard holds at most ${WIDGETS_PER_DASHBOARD} widgets from this catalogue (8 fixed types plus "custom", a declarative spec); nothing else can be shown. Every widget has a "type" and a "title" (≤ ${WIDGET_TITLE_MAX} chars). Fields marked "?" are optional. Fleet, vehicle and driver fields (fleetId, fleetIds, vehicleId, driverId) accept a fleet name, a regno or a driver name as well as an id; an optional fleet means all of the viewer's fleets.`,
  '',
  `Widget types: ${WIDGET_TYPES.join(', ')}.`,
  `Time ranges (relative, in IST): ${TIME_RANGES.join(', ')}.`,
  `KPI fields (daily-chart metrics, ranking metric): ${KPI_FIELDS.join(', ')}. Fields ending in "Ms" are durations in milliseconds (shown as hours).`,
  `KPI metrics (kpi source "analytics"): ${KPI_METRICS.join(', ')}.`,
  `Vehicle statuses: ${VEHICLE_STATUSES.join(', ')}.`,
  `Vehicle list columns: ${VEHICLE_LIST_COLUMNS.join(', ')}.`,
  `Driver statuses: ${DRIVER_STATUSES.join(', ')}.`,
  `Request types: ${REQUEST_TYPES.join(', ')}.`,
  `List limits: 1–${LIST_LIMIT_MAX} rows. Text notes: ≤ ${TEXT_NOTE_MAX} chars of markdown.`,
  '',
  'Previews or direct changes:',
  '- When the user asks for ONE widget (e.g. "add a small KPI of running vehicles"), call preview_widget instead of add_widget: the app shows it as a live preview card and the user adds it, drags it onto the grid, asks for changes or discards it. Keep the answer to one short sentence; do not claim it was added.',
  '- To change a preview ("Change the … preview: …"), call preview_widget again with the new definition.',
  '- Multi-widget builds ("build me a fleet health dashboard"), create_dashboard, and edits, removals, rearranging or renaming of existing widgets use the mutating tools directly (add_widget, update_widget, remove_widget, arrange_widgets, rename_dashboard).',
  '- Lines like "[Previewed widget (not on the dashboard): …]" in earlier answers note a preview you made; it is on the dashboard only if it appears in the <dashboard> block.',
  '',
  ...WIDGET_TYPES.map(section).join('\n\n').split('\n'),
].join('\n');
