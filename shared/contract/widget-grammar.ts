import { z } from 'zod';
import { VEHICLE_STATUSES } from '../domain/vehicle-status.ts';
import { KPI_FIELDS } from './analytics.ts';
import { DRIVER_STATUSES } from './drivers.ts';
import { NOTIFICATION_KINDS } from './notifications.ts';
import type { Permission } from './permissions.ts';
import { BREAKDOWN_REASONS, REQUEST_STATUSES, REQUEST_TYPES } from './requests.ts';

/**
 * F26 (D-144): the `custom` widget grammar — dataset → shape → mark. Pure data, validated here
 * (shape by zod, meaning by `customSpecIssues`) so the store, the tools and the client agree.
 */

// ---- limits ----

export const CUSTOM_ROWS_MAX = 100;
export const CUSTOM_GROUPS_MAX = 50;
export const CUSTOM_CONDITIONS_MAX = 8;
export const CUSTOM_COLUMNS_MAX = 8;
export const CUSTOM_SERIES_MAX = 6;
export const MAP_MARKS_PER_DASHBOARD = 3;
export const MAP_POINTS_MAX = 2000;
/** Rows a REST dataset reads from its endpoint (the endpoints' own maximum). */
export const REST_FETCH_LIMIT = 500;

// ---- vocabulary ----

export const FIELD_TYPES = ['string', 'enum', 'fleet', 'number', 'time'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FILTER_OPS = ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'contains'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const OPS_BY_TYPE: Record<FieldType, readonly FilterOp[]> = {
  string: ['eq', 'ne', 'in', 'nin', 'contains'],
  enum: ['eq', 'ne', 'in', 'nin'],
  fleet: ['eq', 'ne', 'in', 'nin'],
  number: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte'],
  time: [],
};

export const AGGREGATE_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggregateOp = (typeof AGGREGATE_OPS)[number];
export const TIME_BUCKETS = ['hour', 'day', 'week'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];
export const MARK_TYPES = [
  'number',
  'gauge',
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'heatmap',
  'table',
  'map',
] as const;
export type MarkType = (typeof MARK_TYPES)[number];
export const VALUE_FORMATS = ['number', 'percent', 'duration', 'distance', 'datetime'] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];
/** Same values as `TIME_RANGES` (dashboards.ts imports this file; a test keeps them equal). */
export const CUSTOM_RANGES = ['today', 'yesterday', '7d', '30d', '90d'] as const;

// ---- datasets ----

export interface FieldDef {
  type: FieldType;
  label: string;
  unit?: string;
  values?: readonly string[];
  format?: ValueFormat;
  /** analytics-ranking: the entity that has this field (both when absent). */
  entity?: 'vehicles' | 'drivers';
}

export const DATASET_IDS = [
  'live-vehicles',
  'vehicle-history',
  'analytics-series',
  'analytics-ranking',
  'drivers',
  'requests',
  'notifications',
] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

export const DATASET_PARAMS = [
  'range',
  'minutes',
  'vehicle',
  'fleetId',
  'driverId',
  'entity',
] as const;
export type DatasetParam = (typeof DATASET_PARAMS)[number];

export interface DatasetDef {
  summary: string;
  permission: Permission | null;
  /** Fed by the Web Worker (≤ 1 Hz) rather than REST. */
  live: boolean;
  timeField?: string;
  buckets?: readonly TimeBucket[];
  params: readonly DatasetParam[];
  fields: Record<string, FieldDef>;
}

const str = (label: string): FieldDef => ({ type: 'string', label });
const num = (label: string, unit?: string, format?: ValueFormat): FieldDef => ({
  type: 'number',
  label,
  unit,
  format,
});
const time = (label: string): FieldDef => ({ type: 'time', label, format: 'datetime' });
const enumOf = (label: string, values: readonly string[]): FieldDef => ({
  type: 'enum',
  label,
  values,
});
const FLEET: FieldDef = { type: 'fleet', label: 'Fleet' };

const KPI_DEFS: Record<string, FieldDef> = Object.fromEntries(
  KPI_FIELDS.map((f) => {
    const label = f.replace(/Ms$|Km$|Kwh$/, '').replace(/([A-Z])/g, ' $1');
    const nice = label[0]!.toUpperCase() + label.slice(1).toLowerCase();
    if (f.endsWith('Ms')) return [f, num(nice, 'h', 'duration')];
    if (f === 'distanceKm') return [f, num('Distance', 'km', 'distance')];
    if (f === 'energyKwh') return [f, num('Energy', 'kWh')];
    return [f, num(nice)];
  }),
);

export const DATASETS: Record<DatasetId, DatasetDef> = {
  'live-vehicles': {
    summary: 'every vehicle in the viewer’s fleets right now (live, updates every second)',
    permission: 'live.view',
    live: true,
    timeField: 'gpstime',
    buckets: TIME_BUCKETS,
    params: [],
    fields: {
      vehicleId: str('Vehicle id'),
      regno: str('Regno'),
      fleet: FLEET,
      status: enumOf('Status', VEHICLE_STATUSES),
      make: str('Make'),
      model: str('Model'),
      assetType: str('Asset type'),
      fuelType: str('Fuel type'),
      ignition: enumOf('Ignition', ['on', 'off']),
      speed: num('Speed', 'km/h'),
      soc: num('SOC', '%', 'percent'),
      dte: num('Range', 'km', 'distance'),
      odometer: num('Odometer', 'km', 'distance'),
      heading: num('Heading', '°'),
      gpstime: time('Last GPS'),
      lat: num('Latitude'),
      lng: num('Longitude'),
    },
  },
  'vehicle-history': {
    summary: 'GPS trail of ONE vehicle over the last N minutes',
    permission: 'vehicle.details.view',
    live: false,
    timeField: 'time',
    buckets: TIME_BUCKETS,
    params: ['vehicle', 'minutes'],
    fields: { time: time('Time'), lat: num('Latitude'), lng: num('Longitude') },
  },
  'analytics-series': {
    summary: 'fleet KPIs per IST day over a time range (one row per day)',
    permission: 'analytics.view',
    live: false,
    timeField: 'day',
    buckets: ['day', 'week'],
    params: ['range', 'fleetId', 'vehicle', 'driverId'],
    fields: { day: time('Day'), ...KPI_DEFS },
  },
  'analytics-ranking': {
    summary:
      'KPIs per vehicle (entity "vehicles") or per driver (entity "drivers") over a time range; the top 500 rows by the sorted or aggregated KPI',
    permission: 'analytics.view',
    live: false,
    params: ['range', 'fleetId', 'entity'],
    fields: {
      vehicleId: { ...str('Vehicle id'), entity: 'vehicles' },
      regno: { ...str('Regno'), entity: 'vehicles' },
      driverId: { ...str('Driver id'), entity: 'drivers' },
      name: { ...str('Driver'), entity: 'drivers' },
      score: { ...num('Score'), entity: 'drivers' },
      fleet: FLEET,
      ...KPI_DEFS,
    },
  },
  drivers: {
    summary: 'drivers in the viewer’s fleets (up to 500)',
    permission: 'drivers.manage',
    live: false,
    timeField: 'createdAt',
    buckets: TIME_BUCKETS,
    params: ['fleetId'],
    fields: {
      driverId: str('Driver id'),
      name: str('Name'),
      phone: str('Phone'),
      fleet: FLEET,
      status: enumOf('Status', DRIVER_STATUSES),
      createdAt: time('Created'),
    },
  },
  requests: {
    summary: 'driver requests (breakdown, replacement, RSA) created in the time range (up to 500)',
    permission: 'requests.manage',
    live: false,
    timeField: 'createdAt',
    buckets: TIME_BUCKETS,
    params: ['range', 'fleetId'],
    fields: {
      requestId: str('Request id'),
      vehicleId: str('Vehicle id'),
      driverId: str('Driver id'),
      fleet: FLEET,
      type: enumOf('Type', REQUEST_TYPES),
      status: enumOf('Status', REQUEST_STATUSES),
      reason: enumOf('Reason', BREAKDOWN_REASONS),
      createdAt: time('Created'),
      updatedAt: time('Updated'),
    },
  },
  notifications: {
    summary: 'the viewer’s notifications created in the time range (up to 200)',
    permission: null,
    live: false,
    timeField: 'createdAt',
    buckets: TIME_BUCKETS,
    params: ['range'],
    fields: {
      kind: enumOf('Kind', NOTIFICATION_KINDS),
      severity: enumOf('Severity', ['info', 'warning', 'critical']),
      title: str('Title'),
      fleet: FLEET,
      vehicleId: str('Vehicle id'),
      read: enumOf('Read', ['yes', 'no']),
      createdAt: time('Created'),
    },
  },
};

export const datasetPermission = (dataset: string | undefined): Permission | null =>
  DATASETS[dataset as DatasetId]?.permission ?? null;

// ---- schema ----

const fieldName = z.string().min(1).max(40);
const scalar = z.union([z.string().max(80), z.number()]);
const refId = z.string().min(1).max(64);

export const customConditionSchema = z.strictObject({
  field: fieldName,
  op: z.enum(FILTER_OPS),
  value: z.union([scalar, z.array(scalar).min(1).max(20)]),
});
export type CustomCondition = z.infer<typeof customConditionSchema>;

/** Rows match every `all` condition and, when given, at least one `any` condition. */
export const customFilterSchema = z.strictObject({
  all: z.array(customConditionSchema).min(1).max(CUSTOM_CONDITIONS_MAX).optional(),
  any: z.array(customConditionSchema).min(1).max(CUSTOM_CONDITIONS_MAX).optional(),
});
export type CustomFilter = z.infer<typeof customFilterSchema>;

export const customDataSchema = z.strictObject({
  dataset: z.enum(DATASET_IDS),
  filter: customFilterSchema.optional(),
  range: z.enum(CUSTOM_RANGES).optional(),
  minutes: z.number().int().min(5).max(1440).optional(),
  vehicle: refId.optional(),
  fleetId: refId.optional(),
  driverId: refId.optional(),
  entity: z.enum(['vehicles', 'drivers']).optional(),
});
export type CustomData = z.infer<typeof customDataSchema>;

export const customShapeSchema = z.strictObject({
  groupBy: fieldName.optional(),
  timeBucket: z.enum(TIME_BUCKETS).optional(),
  aggregate: z
    .strictObject({ op: z.enum(AGGREGATE_OPS), field: fieldName.optional() })
    .optional(),
  sort: z.strictObject({ by: fieldName, dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(CUSTOM_ROWS_MAX).optional(),
});
export type CustomShape = z.infer<typeof customShapeSchema>;

export const customMarkSchema = z.strictObject({
  type: z.enum(MARK_TYPES),
  x: fieldName.optional(),
  y: fieldName.optional(),
  color: fieldName.optional(),
  size: fieldName.optional(),
  label: fieldName.optional(),
  columns: z.array(fieldName).min(1).max(CUSTOM_COLUMNS_MAX).optional(),
  format: z.enum(VALUE_FORMATS).optional(),
  unit: z.string().max(12).optional(),
  max: z.number().positive().optional(),
  cluster: z.boolean().optional(),
  follow: z.boolean().optional(),
  trailMinutes: z.number().int().min(5).max(240).optional(),
  fit: z.boolean().optional(),
});
export type CustomMark = z.infer<typeof customMarkSchema>;

const customSpecShape = z.strictObject({
  data: customDataSchema,
  shape: customShapeSchema.optional(),
  mark: customMarkSchema,
});
export type CustomSpec = z.infer<typeof customSpecShape>;

// ---- meaning ----

export interface SpecIssue {
  path: (string | number)[];
  message: string;
}

/** Fields of a dataset (analytics-ranking: of its entity). */
export function datasetFields(data: Pick<CustomData, 'dataset' | 'entity'>): Record<string, FieldDef> {
  const def = DATASETS[data.dataset];
  if (data.dataset !== 'analytics-ranking') return def.fields;
  const entity = data.entity ?? 'vehicles';
  return Object.fromEntries(
    Object.entries(def.fields).filter(([, f]) => !f.entity || f.entity === entity),
  );
}

const GROUPABLE: readonly FieldType[] = ['string', 'enum', 'fleet'];

/** True when the spec groups rows (groups, buckets or an aggregate over everything). */
export const isGrouped = (s: CustomSpec) =>
  !!(s.shape?.groupBy || s.shape?.timeBucket || s.shape?.aggregate);

/** The vehicle a follow map tracks (`regno`/`vehicleId` eq condition), if any. */
export function followTarget(s: CustomSpec): { field: 'regno' | 'vehicleId'; value: string } | null {
  for (const c of s.data.filter?.all ?? [])
    if ((c.field === 'regno' || c.field === 'vehicleId') && c.op === 'eq' && typeof c.value === 'string')
      return { field: c.field, value: c.value };
  return null;
}

/**
 * Semantic checks beyond the zod shape: known fields, type-correct ops and values, params per
 * dataset, mark ↔ shape fit and map rules. Messages say how to fix the spec (fed to the model).
 */
export function customSpecIssues(spec: CustomSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const { data, shape = {}, mark } = spec;
  const def = DATASETS[data.dataset];
  const fields = datasetFields(data);
  const names = Object.keys(fields);
  const known = (path: (string | number)[], f: string): FieldDef | null => {
    const fd = fields[f];
    if (!fd) {
      add(path, `Unknown field "${f}" for ${data.dataset}. Use one of: ${names.join(', ')}`);
      return null;
    }
    return fd;
  };

  // params
  for (const p of DATASET_PARAMS)
    if (data[p] !== undefined && !def.params.includes(p))
      add(['data', p], `data.${p} is not used by ${data.dataset} (it takes: ${def.params.join(', ') || 'nothing'})`);
  if (data.dataset === 'vehicle-history' && !data.vehicle)
    add(['data', 'vehicle'], 'vehicle-history needs data.vehicle (a regno or vehicle id)');

  // filter
  (['all', 'any'] as const).forEach((group) =>
    data.filter?.[group]?.forEach((c, k) => {
      const path = ['data', 'filter', group, k];
      const fd = known([...path, 'field'], c.field);
      if (!fd) return;
      if (fd.type === 'time') {
        add([...path, 'field'], `Filter time with data.range, not a condition on "${c.field}"`);
        return;
      }
      if (!OPS_BY_TYPE[fd.type].includes(c.op)) {
        add([...path, 'op'], `Op "${c.op}" does not apply to ${fd.type} field "${c.field}". Use one of: ${OPS_BY_TYPE[fd.type].join(', ')}`);
        return;
      }
      const list = c.op === 'in' || c.op === 'nin';
      if (list !== Array.isArray(c.value)) {
        add([...path, 'value'], list ? `Op "${c.op}" needs a list value` : `Op "${c.op}" needs a single value`);
        return;
      }
      const values = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of values) {
        if (fd.type === 'number' && typeof v !== 'number')
          add([...path, 'value'], `"${c.field}" is a number; give numbers`);
        else if (fd.type !== 'number' && typeof v !== 'string')
          add([...path, 'value'], `"${c.field}" is text; give strings`);
        else if (fd.values && !fd.values.includes(v as string))
          add([...path, 'value'], `"${String(v)}" is not a ${c.field}. Use one of: ${fd.values.join(', ')}`);
        else continue;
        break;
      }
    }),
  );

  // shape
  if (shape.groupBy) {
    const fd = known(['shape', 'groupBy'], shape.groupBy);
    if (fd && !GROUPABLE.includes(fd.type))
      add(['shape', 'groupBy'], `Group by a text, enum or fleet field, not ${fd.type} "${shape.groupBy}" (use timeBucket for time)`);
  }
  if (shape.timeBucket) {
    if (!def.timeField)
      add(['shape', 'timeBucket'], `${data.dataset} has no time field; remove timeBucket`);
    else if (!def.buckets?.includes(shape.timeBucket))
      add(['shape', 'timeBucket'], `${data.dataset} buckets by ${def.buckets?.join(' or ')} only`);
  }
  if (shape.aggregate) {
    const { op, field } = shape.aggregate;
    if (op !== 'count' && !field)
      add(['shape', 'aggregate', 'field'], `aggregate "${op}" needs a number field`);
    if (field) {
      const fd = known(['shape', 'aggregate', 'field'], field);
      if (fd && op !== 'count' && fd.type !== 'number')
        add(['shape', 'aggregate', 'field'], `aggregate "${op}" needs a number field, not ${fd.type} "${field}"`);
    }
  }
  const grouped = isGrouped(spec);
  if (shape.sort && shape.sort.by !== 'value') known(['shape', 'sort', 'by'], shape.sort.by);
  if (shape.sort?.by === 'value' && !grouped)
    add(['shape', 'sort', 'by'], 'Sort by "value" needs groupBy, timeBucket or aggregate; otherwise sort by a field');
  if (shape.groupBy && (shape.limit ?? 0) > CUSTOM_GROUPS_MAX)
    add(['shape', 'limit'], `At most ${CUSTOM_GROUPS_MAX} groups`);

  // mark
  const m = mark;
  const dims = (shape.groupBy ? 1 : 0) + (shape.timeBucket ? 1 : 0);
  const numField = (key: 'x' | 'y' | 'size' | 'color' | 'label', want?: FieldType[]) => {
    const f = m[key];
    if (!f) return null;
    const fd = known(['mark', key], f);
    if (fd && want && !want.includes(fd.type))
      add(['mark', key], `mark.${key} must be a ${want.join(' or ')} field, not ${fd.type} "${f}"`);
    return fd;
  };
  const noMapOptions = () => {
    for (const k of ['cluster', 'follow', 'trailMinutes', 'fit'] as const)
      if (m[k] !== undefined) add(['mark', k], `mark.${k} is only for map marks`);
  };
  switch (m.type) {
    case 'number':
    case 'gauge':
      noMapOptions();
      if (dims) add(['shape'], `A ${m.type} shows one value: remove groupBy/timeBucket (use aggregate)`);
      break;
    case 'bar':
    case 'line':
    case 'area': {
      noMapOptions();
      const rowsMode = !dims;
      if (rowsMode) {
        if (!m.x || !m.y)
          add(['mark'], `A ${m.type} chart needs ${m.type === 'bar' ? 'groupBy or timeBucket' : 'timeBucket'} in shape, or mark.x and mark.y fields`);
        numField('x', m.type === 'bar' ? ['string', 'enum', 'fleet', 'time'] : ['time']);
        numField('y', ['number']);
        if (shape.aggregate) add(['shape', 'aggregate'], 'Without groupBy/timeBucket, plot rows with mark.x/mark.y and no aggregate');
      } else if (m.type !== 'bar' && !shape.timeBucket)
        add(['shape', 'timeBucket'], `A ${m.type} chart is over time: add shape.timeBucket (or use a bar chart)`);
      break;
    }
    case 'pie':
    case 'donut':
      noMapOptions();
      if (!shape.groupBy || shape.timeBucket)
        add(['shape', 'groupBy'], `A ${m.type} needs shape.groupBy and no timeBucket`);
      break;
    case 'heatmap':
      noMapOptions();
      if (!shape.groupBy || !shape.timeBucket)
        add(['shape'], 'A heatmap needs both shape.groupBy (rows) and shape.timeBucket (columns)');
      break;
    case 'table':
      noMapOptions();
      if (!grouped && !m.columns?.length)
        add(['mark', 'columns'], `A row table needs mark.columns (1–${CUSTOM_COLUMNS_MAX} of: ${names.join(', ')})`);
      m.columns?.forEach((c, k) => known(['mark', 'columns', k], c));
      break;
    case 'map': {
      if (data.dataset !== 'live-vehicles' && data.dataset !== 'vehicle-history') {
        add(['data', 'dataset'], 'Map marks need dataset live-vehicles (points) or vehicle-history (a trail)');
        break;
      }
      if (grouped) add(['shape'], 'A map draws rows: remove groupBy, timeBucket and aggregate');
      numField('color', GROUPABLE as FieldType[]);
      numField('size', ['number']);
      numField('label');
      if (m.follow) {
        if (data.dataset !== 'live-vehicles')
          add(['mark', 'follow'], 'follow needs dataset live-vehicles');
        else if (!followTarget(spec))
          add(['data', 'filter'], 'A follow map needs data.filter.all with { field: "regno", op: "eq", value: "<regno>" }. Ask the user which vehicle to follow.');
        if (m.cluster) add(['mark', 'cluster'], 'A follow map shows one vehicle: remove cluster');
      } else if (m.trailMinutes !== undefined && data.dataset === 'live-vehicles')
        add(['mark', 'trailMinutes'], 'trailMinutes needs follow: true (one vehicle)');
      break;
    }
  }
  return issues;
}

export const customSpecSchema = customSpecShape.superRefine((spec, ctx) => {
  for (const issue of customSpecIssues(spec))
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});

/** Widgets with a map mark count against `MAP_MARKS_PER_DASHBOARD`. */
export const isMapSpec = (w: { type: string; spec?: { mark?: { type?: string } } }) =>
  w.type === 'custom' && w.spec?.mark?.type === 'map';
