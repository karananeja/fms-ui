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
};

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
  `A dashboard holds at most ${WIDGETS_PER_DASHBOARD} widgets from this fixed catalogue; nothing else can be shown. Every widget has a "type" and a "title" (≤ ${WIDGET_TITLE_MAX} chars). Fields marked "?" are optional. Fleet, vehicle and driver fields (fleetId, fleetIds, vehicleId, driverId) accept a fleet name, a regno or a driver name as well as an id; an optional fleet means all of the viewer's fleets.`,
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
