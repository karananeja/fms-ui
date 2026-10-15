import { z } from 'zod';
import { VEHICLE_STATUSES } from '../domain/vehicle-status.ts';
import { KPI_FIELDS } from './analytics.ts';
import { epochMsSchema } from './common.ts';
import { DRIVER_STATUSES } from './drivers.ts';
import type { Permission } from './permissions.ts';
import { REQUEST_TYPES } from './requests.ts';

// ---- limits (F18 §3.1, D-120) ----

export const DASHBOARDS_PER_USER = 50;
export const WIDGETS_PER_DASHBOARD = 24;
export const DASHBOARD_TITLE_MAX = 80;
export const DASHBOARD_DESCRIPTION_MAX = 500;
export const WIDGET_TITLE_MAX = 60;
export const TEXT_NOTE_MAX = 2000;
export const LIST_LIMIT_MAX = 50;
export const SHARES_PER_DASHBOARD = 50;
export const THREAD_MESSAGES_MAX = 200;
export const MESSAGE_TEXT_MAX = 8000;
export const DEFAULT_DASHBOARD_TITLE = 'Untitled dashboard';

// ---- common pieces ----

export const widgetIdSchema = z.string().regex(/^w-[a-z0-9-]{1,36}$/, 'Invalid widget id');

/** Relative only; the client resolves it in IST to `from`/`to` (`to` = now). */
export const TIME_RANGES = ['today', 'yesterday', '7d', '30d', '90d'] as const;
export const timeRangeSchema = z.enum(TIME_RANGES);
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const KPI_METRICS = [
  ...KPI_FIELDS,
  'uptimePct',
  'eventsPer100Km',
  'score',
  'vehicleCount',
] as const;
export const kpiMetricSchema = z.enum(KPI_METRICS);
export type KpiMetric = z.infer<typeof kpiMetricSchema>;

const kpiFieldSchema = z.enum(KPI_FIELDS);
const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);
const refId = z.string().min(1).max(64);
const shortStrings = z.array(z.string().min(1).max(40)).min(1).max(20);
const listLimit = z.number().int().min(1).max(LIST_LIMIT_MAX);

/** Column ids of F09 `TABLE_COLUMNS` usable in a `vehicle-list` widget. */
export const VEHICLE_LIST_COLUMNS = [
  'regno',
  'fleet',
  'status',
  'speed',
  'soc',
  'dte',
  'odometer',
  'gpstime',
  'location',
] as const;
export const vehicleListColumnSchema = z.enum(VEHICLE_LIST_COLUMNS);
export type VehicleListColumn = z.infer<typeof vehicleListColumnSchema>;

// ---- widget catalogue (§3.3) ----

const base = <I extends z.ZodType, T extends string>(id: I, type: T) => ({
  id,
  type: z.literal(type),
  title: z.string().trim().min(1).max(WIDGET_TITLE_MAX),
});

function catalogue<I extends z.ZodType>(id: I) {
  const kpi = z.discriminatedUnion('source', [
    z.strictObject({
      ...base(id, 'kpi'),
      source: z.literal('analytics'),
      metric: kpiMetricSchema,
      range: timeRangeSchema,
      fleetId: refId.optional(),
      vehicleId: refId.optional(),
      driverId: refId.optional(),
    }),
    z.strictObject({
      ...base(id, 'kpi'),
      source: z.literal('live'),
      status: z.union([vehicleStatusSchema, z.literal('total')]),
      fleetId: refId.optional(),
    }),
  ]);
  const dailyChart = z.strictObject({
    ...base(id, 'daily-chart'),
    chart: z.enum(['bar', 'line', 'area']),
    metrics: z.array(kpiFieldSchema).min(1).max(3),
    range: z.enum(['7d', '30d', '90d']),
    fleetId: refId.optional(),
    vehicleId: refId.optional(),
    driverId: refId.optional(),
  });
  const statusBreakdown = z.strictObject({
    ...base(id, 'status-breakdown'),
    display: z.enum(['bars', 'donut']),
    statuses: z.array(vehicleStatusSchema).min(1).max(VEHICLE_STATUSES.length).optional(),
    fleetId: refId.optional(),
  });
  const rankingShape = {
    order: z.enum(['desc', 'asc']),
    limit: listLimit,
    range: timeRangeSchema,
    fleetId: refId.optional(),
  };
  const ranking = z.discriminatedUnion('entity', [
    z.strictObject({
      ...base(id, 'ranking'),
      entity: z.literal('vehicles'),
      metric: kpiFieldSchema,
      ...rankingShape,
    }),
    z.strictObject({
      ...base(id, 'ranking'),
      entity: z.literal('drivers'),
      metric: z.union([kpiFieldSchema, z.literal('score')]),
      ...rankingShape,
    }),
  ]);
  const vehicleList = z.strictObject({
    ...base(id, 'vehicle-list'),
    filter: z.strictObject({
      statuses: z.array(vehicleStatusSchema).min(1).max(VEHICLE_STATUSES.length).optional(),
      fleetIds: z.array(refId).min(1).max(20).optional(),
      assetTypes: shortStrings.optional(),
      fuelTypes: shortStrings.optional(),
      makes: shortStrings.optional(),
      socMin: z.number().min(0).max(100).optional(),
      socMax: z.number().min(0).max(100).optional(),
    }),
    columns: z.array(vehicleListColumnSchema).min(1).max(8),
    sort: z.strictObject({ column: vehicleListColumnSchema, dir: z.enum(['asc', 'desc']) }),
    limit: listLimit,
  });
  const driverList = z.strictObject({
    ...base(id, 'driver-list'),
    status: z.enum(DRIVER_STATUSES).optional(),
    fleetId: refId.optional(),
    q: z.string().max(40).optional(),
    limit: listLimit,
  });
  const requestsSummary = z.strictObject({
    ...base(id, 'requests-summary'),
    groupBy: z.enum(['status', 'type']),
    types: z.array(z.enum(REQUEST_TYPES)).min(1).max(REQUEST_TYPES.length).optional(),
    openOnly: z.boolean(),
    fleetId: refId.optional(),
    display: z.enum(['counts', 'latest']),
    limit: listLimit,
  });
  const text = z.strictObject({
    ...base(id, 'text'),
    body: z.string().min(1).max(TEXT_NOTE_MAX),
  });
  return z.discriminatedUnion('type', [
    kpi,
    dailyChart,
    statusBreakdown,
    ranking,
    vehicleList,
    driverList,
    requestsSummary,
    text,
  ]);
}

/** A stored widget (id required). */
export const widgetSchema = catalogue(widgetIdSchema);
export type Widget = z.infer<typeof widgetSchema>;
/** A widget in a write body; the server assigns `w-…` when `id` is absent. */
export const widgetInputSchema = catalogue(widgetIdSchema.optional());
export type WidgetInput = z.infer<typeof widgetInputSchema>;

export const WIDGET_TYPES = [
  'kpi',
  'daily-chart',
  'status-breakdown',
  'ranking',
  'vehicle-list',
  'driver-list',
  'requests-summary',
  'text',
] as const satisfies readonly Widget['type'][];
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Permission the viewer needs to see a widget's data (`kpi` depends on its source, see `widgetPermission`). */
export const WIDGET_PERMISSIONS: Record<WidgetType, Permission | null> = {
  kpi: 'analytics.view',
  'daily-chart': 'analytics.view',
  'status-breakdown': 'live.view',
  ranking: 'analytics.view',
  'vehicle-list': 'live.view',
  'driver-list': 'drivers.manage',
  'requests-summary': 'requests.manage',
  text: null,
};

export const widgetPermission = (w: Pick<WidgetInput, 'type'> & { source?: string }) =>
  w.type === 'kpi' && w.source === 'live' ? 'live.view' : WIDGET_PERMISSIONS[w.type];

/** Default size and minimum on the lg grid. */
export const WIDGET_SIZES: Record<
  WidgetType,
  { w: number; h: number; minW: number; minH: number }
> = {
  kpi: { w: 3, h: 2, minW: 2, minH: 2 },
  'daily-chart': { w: 6, h: 4, minW: 4, minH: 3 },
  'status-breakdown': { w: 4, h: 4, minW: 3, minH: 3 },
  ranking: { w: 6, h: 5, minW: 4, minH: 4 },
  'vehicle-list': { w: 6, h: 5, minW: 4, minH: 4 },
  'driver-list': { w: 6, h: 5, minW: 4, minH: 4 },
  'requests-summary': { w: 6, h: 5, minW: 4, minH: 4 },
  text: { w: 4, h: 2, minW: 2, minH: 1 },
};

// ---- layout (§3.4, react-grid-layout) ----

export const DASHBOARD_BREAKPOINTS = {
  lg: { minWidth: 1200, cols: 12 },
  md: { minWidth: 768, cols: 6 },
  sm: { minWidth: 0, cols: 1 },
} as const;
export type DashboardBreakpoint = keyof typeof DASHBOARD_BREAKPOINTS;
export const BREAKPOINT_IDS = ['lg', 'md', 'sm'] as const satisfies DashboardBreakpoint[];
export const LAYOUT_ROW_MAX = 24;

export const layoutItemSchema = z.strictObject({
  i: widgetIdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1).max(LAYOUT_ROW_MAX),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
});
export type LayoutItem = z.infer<typeof layoutItemSchema>;

export const dashboardLayoutSchema = z.strictObject({
  lg: z.array(layoutItemSchema).max(WIDGETS_PER_DASHBOARD),
  md: z.array(layoutItemSchema).max(WIDGETS_PER_DASHBOARD),
  sm: z.array(layoutItemSchema).max(WIDGETS_PER_DASHBOARD),
});
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

export interface LayoutIssue {
  path: (string | number)[];
  message: string;
}

/**
 * §3.4 rules per breakpoint: `x + w ≤ cols`, unique `i`, `i` references a widget,
 * `w ≥ minW`, `h ≥ minH`. Paths are relative to the layout. Overlaps are allowed.
 */
export function layoutIssues(widgetIds: readonly string[], layout: DashboardLayout): LayoutIssue[] {
  const ids = new Set(widgetIds);
  const issues: LayoutIssue[] = [];
  for (const bp of BREAKPOINT_IDS) {
    const { cols } = DASHBOARD_BREAKPOINTS[bp];
    const seen = new Set<string>();
    layout[bp].forEach((item, n) => {
      const at = (key: string, message: string) => issues.push({ path: [bp, n, key], message });
      if (item.x + item.w > cols) at('w', `x + w must be ≤ ${cols} on ${bp}`);
      if (seen.has(item.i)) at('i', `Duplicate layout item ${item.i}`);
      seen.add(item.i);
      if (!ids.has(item.i)) at('i', `Layout item ${item.i} references no widget`);
      if (item.minW !== undefined && item.w < item.minW) at('w', 'w must be ≥ minW');
      if (item.minH !== undefined && item.h < item.minH) at('h', 'h must be ≥ minH');
    });
  }
  return issues;
}

// ---- content & resources (§3.5) ----

const titleSchema = z.string().trim().min(1).max(DASHBOARD_TITLE_MAX);
const descriptionSchema = z.string().max(DASHBOARD_DESCRIPTION_MAX);

function refineContent(
  value: { widgets?: { id?: string }[]; layout?: DashboardLayout },
  ctx: z.RefinementCtx,
) {
  const ids = (value.widgets ?? []).map((w) => w.id).filter((id): id is string => !!id);
  const seen = new Set<string>();
  ids.forEach((id) => {
    if (seen.has(id))
      ctx.addIssue({ code: 'custom', path: ['widgets'], message: `Duplicate widget id ${id}` });
    seen.add(id);
  });
  if (value.layout && value.widgets) {
    for (const issue of layoutIssues(ids, value.layout))
      ctx.addIssue({ code: 'custom', path: ['layout', ...issue.path], message: issue.message });
  }
}

/** Editable content of a dashboard; every store write validates against this (after normalising). */
export const dashboardContentSchema = z
  .strictObject({
    title: titleSchema,
    description: descriptionSchema,
    widgets: z.array(widgetSchema).max(WIDGETS_PER_DASHBOARD),
    layout: dashboardLayoutSchema,
  })
  .superRefine(refineContent);
export type DashboardContent = z.infer<typeof dashboardContentSchema>;

export const dashboardAccessSchema = z.enum(['owner', 'viewer']);
export type DashboardAccess = z.infer<typeof dashboardAccessSchema>;

export const dashboardSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  title: z.string(),
  description: z.string(),
  widgets: z.array(widgetSchema),
  layout: dashboardLayoutSchema,
  version: z.number().int().min(1),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
  access: dashboardAccessSchema,
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardSummarySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  title: z.string(),
  description: z.string(),
  widgetCount: z.number().int().nonnegative(),
  version: z.number().int().min(1),
  updatedAt: epochMsSchema,
  access: dashboardAccessSchema,
  /** 0 for viewers. */
  shareCount: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** Each list sorted by `updatedAt` desc. */
export const dashboardListSchema = z.object({
  mine: z.array(dashboardSummarySchema),
  sharedWithMe: z.array(dashboardSummarySchema),
});
export type DashboardList = z.infer<typeof dashboardListSchema>;

export const createDashboardBodySchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    widgets: z.array(widgetInputSchema).max(WIDGETS_PER_DASHBOARD).optional(),
    layout: dashboardLayoutSchema.optional(),
  })
  .superRefine(refineContent);
export type CreateDashboardBody = z.infer<typeof createDashboardBodySchema>;

/** `widgets` / `layout` replace the whole value; at least one field besides `version`. */
export const updateDashboardBodySchema = z
  .strictObject({
    version: z.number().int().min(1),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    widgets: z.array(widgetInputSchema).max(WIDGETS_PER_DASHBOARD).optional(),
    layout: dashboardLayoutSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const fields = [value.title, value.description, value.widgets, value.layout];
    if (fields.every((v) => v === undefined))
      ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to update' });
    refineContent(value, ctx);
  });
export type UpdateDashboardBody = z.infer<typeof updateDashboardBodySchema>;

export const duplicateDashboardBodySchema = z.strictObject({ title: titleSchema.optional() });
export type DuplicateDashboardBody = z.infer<typeof duplicateDashboardBodySchema>;

export const dashboardShareSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  sharedAt: epochMsSchema,
});
export type DashboardShare = z.infer<typeof dashboardShareSchema>;
export const dashboardShareListSchema = z.array(dashboardShareSchema);

export const shareCandidateSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
});
export type ShareCandidate = z.infer<typeof shareCandidateSchema>;
export const shareCandidateListSchema = z.array(shareCandidateSchema).max(50);
export const shareCandidateQuerySchema = z.object({ q: z.string().max(40).optional() });

export const addSharesBodySchema = z.strictObject({
  userIds: z.array(z.string().min(1)).min(1).max(20),
});
export type AddSharesBody = z.infer<typeof addSharesBodySchema>;

export const toolChipSchema = z.strictObject({
  tool: z.string().min(1).max(64),
  label: z.string().max(120),
  status: z.enum(['ok', 'error']),
});
export type ToolChip = z.infer<typeof toolChipSchema>;

export const changeSetSchema = z.object({
  id: z.string(),
  summary: z.string(),
  beforeVersion: z.number().int().min(1),
  afterVersion: z.number().int().min(1),
  undoneAt: epochMsSchema.nullable(),
  undoable: z.boolean(),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

// ---- widget previews in chat (F19/F20 addendum, D-135) ----

export const WIDGET_PREVIEW_STATUSES = ['pending', 'added', 'discarded'] as const;
export const widgetPreviewStatusSchema = z.enum(WIDGET_PREVIEW_STATUSES);
export type WidgetPreviewStatus = z.infer<typeof widgetPreviewStatusSchema>;

/** A widget the assistant proposed (`preview_widget`); not on the dashboard until the user adds it. */
export const widgetPreviewSchema = z.object({
  id: z.string(),
  /** `null` in the global chat when no dashboard was named. */
  dashboardId: z.string().nullable(),
  widget: widgetSchema,
  /** Default lg size of the widget type (`WIDGET_SIZES`). */
  size: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }),
  status: widgetPreviewStatusSchema,
  createdAt: epochMsSchema,
});
export type WidgetPreview = z.infer<typeof widgetPreviewSchema>;

/** `PATCH /api/dashboards/:id/previews/:previewId`: records the card state only. */
export const updatePreviewBodySchema = z.strictObject({ status: z.enum(['added', 'discarded']) });
export type UpdatePreviewBody = z.infer<typeof updatePreviewBodySchema>;

/** Previews stored per assistant message. */
export const PREVIEWS_PER_MESSAGE_MAX = 30;

export const threadRoleSchema = z.enum(['user', 'assistant']);
export const threadMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int().min(1),
  role: threadRoleSchema,
  text: z.string().max(MESSAGE_TEXT_MAX),
  chips: z.array(toolChipSchema),
  change: changeSetSchema.nullable(),
  /** D-135: widget previews made in this (assistant) message. */
  previews: z.array(widgetPreviewSchema).default([]),
  createdAt: epochMsSchema,
});
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/** Oldest first, ≤ `THREAD_MESSAGES_MAX`. */
export const dashboardThreadSchema = z.object({
  messages: z.array(threadMessageSchema).max(THREAD_MESSAGES_MAX),
});
export type DashboardThread = z.infer<typeof dashboardThreadSchema>;

/** In-process only (F19 appends turns through the store). */
export const appendMessageSchema = z.strictObject({
  role: threadRoleSchema,
  text: z.string().max(MESSAGE_TEXT_MAX),
  chips: z.array(toolChipSchema).max(50).default([]),
  changeId: z.string().optional(),
  previews: z.array(widgetPreviewSchema).max(PREVIEWS_PER_MESSAGE_MAX).default([]),
});
export type AppendMessage = z.input<typeof appendMessageSchema>;

export const undoBodySchema = z.strictObject({ version: z.number().int().min(1) });
export type UndoBody = z.infer<typeof undoBodySchema>;
