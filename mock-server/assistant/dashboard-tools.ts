import {
  DASHBOARD_BREAKPOINTS,
  DASHBOARD_CHAT_MAX_MUTATIONS,
  DASHBOARD_DESCRIPTION_MAX,
  DASHBOARD_TITLE_MAX,
  DASHBOARDS_PER_USER,
  LAYOUT_ROW_MAX,
  PREVIEW_WIDGET_TOOL,
  PREVIEWS_PER_MESSAGE_MAX,
  WIDGET_SIZES,
  WIDGET_TYPES,
  WIDGETS_PER_DASHBOARD,
  widgetIdSchema,
  widgetPermission,
  widgetSchema,
  widgetToolInputSchema,
  customSpecSchema,
  followTarget,
  type CustomCondition,
  type CustomSpec,
  type Dashboard,
  type DashboardLayout,
  type LayoutItem,
  type Permission,
  type Widget,
  type WidgetInput,
  type WidgetPreview,
  type WidgetToolInput,
  type WidgetType,
} from '@shared/contract/index.ts';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../http-error.ts';
import { newWidgetId, type DashboardDraft } from '../store/dashboards.ts';
import {
  has,
  newTurnState,
  notFound,
  resolveFleet,
  resolveVehicle,
  spec,
  ToolFailure,
  type ToolHost,
  type ToolSpec,
} from './tool-kit.ts';

/**
 * F19 §3: the seven dashboard tools. Same definitions in both chats (cache-stable); behaviour
 * depends on `host.mode`. Owner-only, except that an editor (F27) works on the shared dashboard
 * of their own dashboard chat; other people's dashboards (and view-only or other shared ones) read
 * as "not found among your dashboards". Writes run as the acting user (`applyTurn(host.user.id)`:
 * change-set actor, activity, `widget_not_permitted`). Every write goes through the F18 store
 * (`create` / `applyTurn`), so only catalogue widgets can be saved (D-116).
 */

export const dashboardUrl = (id: string) => `/dashboards/${id}`;

/** Widget types the user may put on a dashboard (`widgetPermission` × the user's permissions). */
export function permittedWidgetTypes(permissions: readonly Permission[]): WidgetType[] {
  return WIDGET_TYPES.filter((t) => {
    if (t === 'kpi')
      return permissions.includes('analytics.view') || permissions.includes('live.view');
    // F26: custom is usable when any dataset is (notifications need no permission).
    if (t === 'custom') return true;
    const p = widgetPermission({ type: t });
    return p === null || permissions.includes(p);
  });
}

const notOwned = (ref: string) =>
  new ToolFailure(`Dashboard ${ref} was not found among your dashboards.`, 'not_found');

const GLOBAL_ONLY_CREATE = () =>
  new ToolFailure(
    "Changes are made in the dashboard's own chat. Offer the user the link /dashboards/<id> (get_dashboard gives the id).",
  );

function requireUse(host: ToolHost) {
  if (!has(host, 'dashboards.use'))
    throw new ToolFailure(
      'Not permitted: your role does not allow using dashboards.',
      'not_permitted',
    );
}

/**
 * The current dashboard of a dashboard chat (owner or, F27, an editor in their own chat); the
 * global chat can't mutate.
 */
function current(host: ToolHost): Dashboard {
  requireUse(host);
  const mode = host.mode ?? { kind: 'global' };
  if (mode.kind !== 'dashboard') throw GLOBAL_ONLY_CREATE();
  return owned(host, mode.dashboardId);
}

/**
 * The caller's dashboard `id`: owned, or (F27, D-150) shared with edit access when `id` is the
 * dashboard of this dashboard chat. Anything else reads as "not found among your dashboards".
 */
function owned(host: ToolHost, id: string): Dashboard {
  let d: Dashboard;
  try {
    d = host.ctx.dashboards.get(host.user.id, id);
  } catch (err) {
    if (err instanceof HttpError) throw notOwned(id);
    throw err;
  }
  const mode = host.mode ?? { kind: 'global' };
  const ownChat = mode.kind === 'dashboard' && mode.dashboardId === id;
  if (d.access === 'owner' || (d.access === 'editor' && ownChat)) return d;
  throw notOwned(id);
}

/** Store errors → model-visible failures. */
function storeFailure(err: unknown): never {
  if (err instanceof ToolFailure) throw err;
  if (err instanceof HttpError) {
    if (err.status === 404 || err.status === 403) throw notOwned('');
    if (err.code === 'dashboard_limit')
      throw new ToolFailure(`You already own ${DASHBOARDS_PER_USER} dashboards (the maximum).`);
    if (err.code === 'widget_not_permitted')
      throw new ToolFailure(`Not permitted: ${err.message}`, 'not_permitted');
    if (err.code === 'version_conflict')
      throw new ToolFailure('The dashboard changed while I was editing it. Try again.');
    if (err.status === 422) {
      const issues = Array.isArray(err.details)
        ? (err.details as { path?: (string | number)[]; message?: string }[])
        : [];
      const where = issues[0]?.path?.length ? ` (${issues[0].path.join('.')})` : '';
      throw new ToolFailure(`Invalid dashboard: ${err.message}${where}`);
    }
  }
  throw err;
}

// ---- reference resolution (names → ids, in the user's scope) ----

function resolveVehicleRef(host: ToolHost, ref: string): string {
  const { sim, tree } = host.ctx;
  const i = sim.indexOf(ref);
  if (i >= 0) {
    if (!tree.inScope(sim.fleetId(i), host.user.fleetIds)) throw notFound(`Vehicle ${ref}`);
    return sim.vehicleId(i);
  }
  return sim.vehicleId(resolveVehicle(host, { regno: ref }));
}

function resolveDriverRef(host: ToolHost, ref: string): string {
  const { drivers, tree } = host.ctx;
  const byId = drivers.indexOf(ref);
  if (byId >= 0) {
    if (!tree.inScope(drivers.fleetId(byId), host.user.fleetIds)) throw notFound(`Driver ${ref}`);
    return drivers.get(byId).id;
  }
  const q = ref.trim().toLowerCase();
  const mask = tree.scopeMask(host.user.fleetIds);
  const matches: number[] = [];
  for (let d = 0; d < drivers.count; d++)
    if (mask[drivers.fleetIdx(d)] && drivers.name(d).toLowerCase() === q) matches.push(d);
  if (matches.length > 1)
    throw new ToolFailure(
      `${matches.length} drivers are named "${ref}". Use find_drivers and pass the driver id.`,
    );
  if (!matches.length) throw notFound(`Driver ${ref}`);
  return drivers.get(matches[0]!).id;
}

/** A tool widget → a store widget input: permission check, then names resolved to ids. */
function toWidgetInput(host: ToolHost, w: WidgetToolInput): WidgetInput {
  const permission = widgetPermission(w as WidgetInput);
  if (permission && !has(host, permission))
    throw new ToolFailure(
      `Not permitted: your role can't see ${w.type} data (${permission}).`,
      'not_permitted',
    );
  const out = { ...w } as Record<string, unknown>;
  if (typeof out.fleetId === 'string') out.fleetId = resolveFleet(host, out.fleetId);
  if (typeof out.vehicleId === 'string') out.vehicleId = resolveVehicleRef(host, out.vehicleId);
  if (typeof out.driverId === 'string') out.driverId = resolveDriverRef(host, out.driverId);
  if (w.type === 'vehicle-list' && w.filter.fleetIds)
    out.filter = { ...w.filter, fleetIds: w.filter.fleetIds.map((f) => resolveFleet(host, f)!) };
  if (w.type === 'custom') out.spec = resolveCustomSpec(host, w.spec);
  return out as WidgetInput;
}

/**
 * F26: a custom spec checked (fixable messages for the model) and its references resolved in the
 * user's scope: `data.vehicle` → vehicle id, `fleetId` / `fleet` condition values → fleet ids,
 * `driverId` → driver id, and a follow map's regno must be a vehicle the user can see.
 */
function resolveCustomSpec(host: ToolHost, spec: CustomSpec): CustomSpec {
  const parsed = customSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (widget.spec.${issue.path.join('.')})` : '';
    throw new ToolFailure(`Invalid custom widget: ${issue?.message ?? 'invalid'}${where}`);
  }
  const data = { ...spec.data };
  if (data.vehicle) data.vehicle = resolveVehicleRef(host, data.vehicle);
  if (data.fleetId) data.fleetId = resolveFleet(host, data.fleetId);
  if (data.driverId) data.driverId = resolveDriverRef(host, data.driverId);
  const cond = (c: CustomCondition): CustomCondition => {
    if (c.field === 'fleet') {
      const one = (v: string | number) => resolveFleet(host, String(v))!;
      return { ...c, value: Array.isArray(c.value) ? c.value.map(one) : one(c.value) };
    }
    return c;
  };
  if (data.filter)
    data.filter = {
      ...(data.filter.all && { all: data.filter.all.map(cond) }),
      ...(data.filter.any && { any: data.filter.any.map(cond) }),
    };
  const target = spec.mark.follow ? followTarget({ ...spec, data }) : null;
  // The follow target must be a vehicle the user can see (throws "Vehicle … not found").
  if (target) resolveVehicleRef(host, target.value);
  return { ...spec, data };
}

// ---- layout helpers ----

/** Widget ids in lg reading order (rows top to bottom, then left to right). */
export function readingOrder(d: { widgets: readonly { id?: string }[]; layout: DashboardLayout }) {
  const pos = new Map(d.layout.lg.map((it) => [it.i, it]));
  const ids = d.widgets.map((w) => w.id).filter((id): id is string => !!id);
  return ids
    .map((id, k) => ({ id, k, it: pos.get(id) }))
    .sort((a, b) => {
      if (a.it && b.it) return a.it.y - b.it.y || a.it.x - b.it.x || a.k - b.k;
      if (a.it) return -1;
      if (b.it) return 1;
      return a.k - b.k;
    })
    .map((e) => e.id);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Packs items in rows in the given order on a `cols`-wide grid. */
function pack(
  items: { i: string; w: number; h: number; minW: number; minH: number }[],
  cols: number,
) {
  const out: LayoutItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of items) {
    if (x + it.w > cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    out.push({ i: it.i, x, y, w: it.w, h: it.h, minW: it.minW, minH: it.minH });
    x += it.w;
    rowH = Math.max(rowH, it.h);
  }
  return out;
}

/** After a type change: grow the widget's items to the new type's minimums at every breakpoint. */
function fitToType(layout: DashboardLayout, id: string, type: WidgetType) {
  const size = WIDGET_SIZES[type];
  for (const bp of ['lg', 'md', 'sm'] as const) {
    const cols = DASHBOARD_BREAKPOINTS[bp].cols;
    const it = layout[bp].find((x) => x.i === id);
    if (!it) continue;
    const minW = bp === 'sm' ? 1 : Math.min(size.minW, cols);
    it.minW = minW;
    it.minH = size.minH;
    it.w = clamp(it.w, minW, cols);
    it.h = clamp(it.h, size.minH, LAYOUT_ROW_MAX);
    if (it.x + it.w > cols) it.x = cols - it.w;
  }
}

// ---- mutations (dashboard chat) ----

const quoted = (s: string) => `"${s}"`;

/**
 * One mutating call on the current dashboard: rebased on the current version (the model never
 * sees a 409), extending the turn's change set when nothing else was written since (D-124).
 */
function mutate(
  host: ToolHost,
  chip: string,
  summaryLabel: (d: Dashboard) => string,
  fn: (draft: DashboardDraft, d: Dashboard) => void,
): { before: Dashboard; dashboard: Dashboard } {
  const d = current(host);
  const turn = (host.turn ??= newTurnState());
  if (turn.mutations >= DASHBOARD_CHAT_MAX_MUTATIONS)
    throw new ToolFailure('Too many changes in one turn; continue in a new message.');
  let label = '';
  let res: ReturnType<typeof host.ctx.dashboards.applyTurn>;
  try {
    res = host.ctx.dashboards.applyTurn(
      host.user.id,
      d.id,
      d.version,
      (extending) => [...(extending ? turn.labels : []), (label = summaryLabel(d))].join('; '),
      (draft) => fn(draft, d),
      { extend: turn.changeId },
    );
  } catch (err) {
    storeFailure(err);
  }
  turn.labels = res.extended ? [...turn.labels, label] : [label];
  turn.changeId = res.change.id;
  turn.mutations++;
  host.emit({
    type: 'dashboard_changed',
    dashboardId: d.id,
    changeId: res.change.id,
    version: res.dashboard.version,
    label: chip,
    summary: res.change.summary,
    dashboard: res.dashboard,
  });
  return { before: d, dashboard: res.dashboard };
}

const requireWidget = (d: Dashboard, id: string) => {
  const w = d.widgets.find((x) => x.id === id);
  if (!w) throw new ToolFailure(`Widget ${id} was not found on this dashboard.`, 'not_found');
  return w;
};

// ---- tool definitions ----

const titleInput = z.string().trim().min(1).max(DASHBOARD_TITLE_MAX);
const descriptionInput = z.string().max(DASHBOARD_DESCRIPTION_MAX);
const widgetInput = widgetToolInputSchema.describe(
  'One catalogue widget (see "Dashboard widget catalogue" in the instructions). Fleet, vehicle and driver fields take a name/regno or an id.',
);

const createDashboard = spec({
  name: 'create_dashboard',
  description: `Create a new dashboard owned by the user, with all its widgets in one call (at most ${WIDGETS_PER_DASHBOARD}). Returns its id and URL (/dashboards/<id>). In a dashboard's own chat this creates a separate dashboard.`,
  schema: z.strictObject({
    title: titleInput,
    description: descriptionInput.optional(),
    widgets: z.array(widgetInput).max(WIDGETS_PER_DASHBOARD).optional(),
  }),
  validateInRun: true,
  label: (i) => `Creating dashboard ${quoted(i.title)}…`,
  async run(host, input) {
    requireUse(host);
    const widgets = (input.widgets ?? []).map((w) => toWidgetInput(host, w));
    let d: Dashboard;
    try {
      d = host.ctx.dashboards.create(host.user.id, {
        title: input.title,
        description: input.description,
        widgets,
      });
    } catch (err) {
      storeFailure(err);
    }
    const n = d.widgets.length;
    const chip = `Created dashboard ${quoted(d.title)} (${n} widget${n === 1 ? '' : 's'})`;
    const summary = host.ctx.dashboards.list(host.user.id).mine.find((s) => s.id === d.id)!;
    const url = dashboardUrl(d.id);
    host.emit({ type: 'dashboard_created', dashboard: summary, url });
    (host.turn ??= newTurnState()).created.push({
      id: d.id,
      chip: { tool: 'create_dashboard', label: chip.slice(0, 120), status: 'ok' },
    });
    return {
      result: {
        dashboardId: d.id,
        url,
        version: d.version,
        widgets: d.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title })),
      },
      summary: `${n} widgets`,
      chip,
    };
  },
});

const getDashboard = spec({
  name: 'get_dashboard',
  description:
    "Read one of the user's own dashboards: title, description, version and every widget with its settings, in reading order. `dashboard` is an id or a title (exact or partial); in a dashboard's chat it defaults to that dashboard. Without it in the global chat, lists the user's dashboards.",
  schema: z.strictObject({
    dashboard: z.string().max(DASHBOARD_TITLE_MAX).describe('Dashboard id or title.').optional(),
  }),
  validateInRun: true,
  label: () => 'Reading dashboard…',
  async run(host, input) {
    requireUse(host);
    const mode = host.mode ?? { kind: 'global' };
    const mine = host.ctx.dashboards.list(host.user.id).mine;
    let id: string | undefined;
    const ref = input.dashboard?.trim();
    if (ref) {
      const q = ref.toLowerCase();
      const exact = mine.filter((s) => s.id === ref || s.title.toLowerCase() === q);
      const matches = exact.length ? exact : mine.filter((s) => s.title.toLowerCase().includes(q));
      if (matches.length > 1)
        return {
          result: {
            ambiguous: true,
            message: `${matches.length} of your dashboards match "${ref}". Ask the user which one.`,
            matches: matches.slice(0, 10).map((s) => ({ id: s.id, title: s.title })),
          },
          summary: `${matches.length} matches`,
        };
      if (!matches.length) throw notOwned(quoted(ref));
      id = matches[0]!.id;
    } else if (mode.kind === 'dashboard') id = mode.dashboardId;
    else
      return {
        result: {
          dashboards: mine.map((s) => ({
            id: s.id,
            title: s.title,
            widgetCount: s.widgetCount,
            url: dashboardUrl(s.id),
          })),
        },
        summary: `${mine.length} dashboards`,
      };
    const d = owned(host, id);
    return {
      result: {
        id: d.id,
        url: dashboardUrl(d.id),
        title: d.title,
        description: d.description,
        version: d.version,
        widgets: d.widgets,
        order: readingOrder(d),
      },
      summary: d.title,
    };
  },
});

const addWidget = spec({
  name: 'add_widget',
  description: `Add one widget to the current dashboard (dashboard chat only; at most ${WIDGETS_PER_DASHBOARD} widgets). It is placed at the bottom with its default size. Call it several times in parallel to add several widgets.`,
  schema: z.strictObject({ widget: widgetInput }),
  validateInRun: true,
  label: (i) => `Adding widget: ${i.widget.title}…`,
  async run(host, input) {
    const d = current(host);
    if (d.widgets.length >= WIDGETS_PER_DASHBOARD)
      throw new ToolFailure(
        `This dashboard already has ${WIDGETS_PER_DASHBOARD} widgets (the maximum).`,
      );
    let id = newWidgetId();
    while (d.widgets.some((w) => w.id === id)) id = newWidgetId();
    const widget = { ...toWidgetInput(host, input.widget), id } as Widget;
    const { dashboard } = mutate(
      host,
      `Added widget: ${widget.title}`,
      () => `Added widget ${quoted(widget.title)} (${id})`,
      (draft) => void draft.widgets.push(widget),
    );
    return {
      result: { widgetId: id, version: dashboard.version },
      summary: widget.title,
      chip: `Added widget: ${widget.title}`,
    };
  },
});

/**
 * D-135: one widget shown as a preview card in the chat; validated like `add_widget` (catalogue,
 * name resolution, `widget_not_permitted`) but nothing is written to the dashboard.
 */
const previewWidget = spec({
  name: PREVIEW_WIDGET_TOOL,
  description: `Show ONE proposed widget as a live preview card in the chat, without changing any dashboard. The user then adds it (or drags it onto the grid), asks for changes, or discards it. Use this when the user asks for a single widget. \`dashboardId\` is the dashboard it is meant for: in a dashboard's chat that dashboard (it may be omitted); in the global chat optional.`,
  schema: z.strictObject({
    dashboardId: z.string().max(64).describe('Id of one of your dashboards.').optional(),
    widget: widgetInput,
  }),
  validateInRun: true,
  label: (i) => `Previewing widget: ${i.widget.title}…`,
  async run(host, input) {
    requireUse(host);
    const mode = host.mode ?? { kind: 'global' };
    const dashboardId =
      mode.kind === 'dashboard'
        ? mode.dashboardId
        : input.dashboardId
          ? owned(host, input.dashboardId).id
          : null;
    if (mode.kind === 'dashboard') owned(host, dashboardId!);
    const turn = (host.turn ??= newTurnState());
    if (turn.previews.length >= PREVIEWS_PER_MESSAGE_MAX)
      throw new ToolFailure('Too many previews in one turn; continue in a new message.');
    const parsed = widgetSchema.safeParse({
      ...toWidgetInput(host, input.widget),
      id: newWidgetId(),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` (widget.${issue.path.join('.')})` : '';
      throw new ToolFailure(`Invalid widget: ${issue?.message ?? 'invalid'}${where}`);
    }
    const widget = parsed.data;
    const { w, h } = WIDGET_SIZES[widget.type];
    const preview: WidgetPreview = {
      id: `pv-${randomBytes(6).toString('hex')}`,
      dashboardId,
      widget,
      size: { w, h },
      status: 'pending',
      createdAt: host.ctx.clock.now(),
    };
    turn.previews.push(preview);
    host.emit({ type: 'widget_preview', preview });
    return {
      result: {
        previewId: preview.id,
        widget,
        note: 'Shown to the user as a preview card; the dashboard is unchanged until they add it.',
      },
      summary: widget.title,
      chip: `Previewed widget: ${widget.title}`,
    };
  },
});

const updateWidget = spec({
  name: 'update_widget',
  description:
    'Replace one widget of the current dashboard with a new definition (full replacement; the type may change). It keeps its id and place on the grid. Dashboard chat only.',
  schema: z.strictObject({ widgetId: widgetIdSchema, widget: widgetInput }),
  validateInRun: true,
  label: () => 'Updating widget…',
  async run(host, input) {
    const d = current(host);
    requireWidget(d, input.widgetId);
    const widget = { ...toWidgetInput(host, input.widget), id: input.widgetId } as Widget;
    const { dashboard } = mutate(
      host,
      `Updated widget: ${widget.title}`,
      () => `Updated widget ${quoted(widget.title)} (${widget.id})`,
      (draft) => {
        const k = draft.widgets.findIndex((w) => w.id === input.widgetId);
        if (k < 0)
          throw new ToolFailure(
            `Widget ${input.widgetId} was not found on this dashboard.`,
            'not_found',
          );
        const prevType = draft.widgets[k]!.type;
        draft.widgets[k] = widget;
        if (prevType !== widget.type) fitToType(draft.layout, widget.id, widget.type);
      },
    );
    return {
      result: { widgetId: widget.id, version: dashboard.version },
      summary: widget.title,
      chip: `Updated widget: ${widget.title}`,
    };
  },
});

const removeWidget = spec({
  name: 'remove_widget',
  description:
    'Remove one or more widgets (by id) from the current dashboard. Dashboard chat only.',
  schema: z.strictObject({
    widgetIds: z.array(widgetIdSchema).min(1).max(WIDGETS_PER_DASHBOARD),
  }),
  validateInRun: true,
  label: (i) => (i.widgetIds.length === 1 ? 'Removing widget…' : 'Removing widgets…'),
  async run(host, input) {
    const d = current(host);
    const ids = [...new Set(input.widgetIds)];
    const gone = ids.map((id) => requireWidget(d, id));
    const chip =
      gone.length === 1 ? `Removed widget: ${gone[0]!.title}` : `Removed ${gone.length} widgets`;
    const { dashboard } = mutate(
      host,
      chip,
      () => gone.map((w) => `Removed widget ${quoted(w.title)} (${w.id})`).join('; '),
      (draft) => {
        draft.widgets = draft.widgets.filter((w) => !ids.includes(w.id ?? ''));
      },
    );
    return { result: { removed: ids, version: dashboard.version }, summary: chip, chip };
  },
});

const arrangeWidgets = spec({
  name: 'arrange_widgets',
  description:
    "Reorder (and optionally resize) the widgets of the current dashboard. `order` lists widget ids in reading order (left to right, top to bottom); unlisted widgets follow in their current order. `sizes` sets width (1–12 columns) and height (1–24 rows); sizes are clamped to each type's minimum. Dashboard chat only.",
  schema: z.strictObject({
    order: z.array(widgetIdSchema).min(1).max(WIDGETS_PER_DASHBOARD),
    sizes: z
      .array(
        z.strictObject({
          widgetId: widgetIdSchema,
          w: z.number().int().min(1).max(12),
          h: z.number().int().min(1).max(LAYOUT_ROW_MAX),
        }),
      )
      .max(WIDGETS_PER_DASHBOARD)
      .optional(),
  }),
  validateInRun: true,
  label: () => 'Rearranging widgets…',
  async run(host, input) {
    const d = current(host);
    for (const id of [...input.order, ...(input.sizes ?? []).map((s) => s.widgetId)])
      requireWidget(d, id);
    if (new Set(input.order).size !== input.order.length)
      throw new ToolFailure('`order` lists a widget more than once.');
    const { dashboard } = mutate(
      host,
      'Rearranged widgets',
      () => 'Rearranged widgets',
      (draft) => {
        const all = readingOrder(draft);
        const order = [...input.order, ...all.filter((id) => !input.order.includes(id))];
        const sizes = new Map((input.sizes ?? []).map((s) => [s.widgetId, s]));
        const type = new Map(draft.widgets.map((w) => [w.id!, w.type]));
        const lgItem = new Map(draft.layout.lg.map((it) => [it.i, it]));
        const lg = order.map((i) => {
          const size = WIDGET_SIZES[type.get(i)!];
          const want = sizes.get(i) ?? lgItem.get(i) ?? size;
          return {
            i,
            w: clamp(want.w, size.minW, 12),
            h: clamp(want.h, size.minH, LAYOUT_ROW_MAX),
            minW: size.minW,
            minH: size.minH,
          };
        });
        draft.layout = {
          lg: pack(lg, 12),
          md: pack(
            lg.map((it) => ({ ...it, w: Math.min(it.w, 6), minW: Math.min(it.minW, 6) })),
            6,
          ),
          sm: pack(
            lg.map((it) => ({ ...it, w: 1, minW: 1 })),
            1,
          ),
        };
      },
    );
    return {
      result: { version: dashboard.version, order: readingOrder(dashboard) },
      summary: 'Rearranged',
      chip: 'Rearranged widgets',
    };
  },
});

const renameDashboard = spec({
  name: 'rename_dashboard',
  description:
    'Change the title and/or description of the current dashboard (at least one). Dashboard chat only.',
  schema: z
    .strictObject({ title: titleInput.optional(), description: descriptionInput.optional() })
    .refine((v) => v.title !== undefined || v.description !== undefined, {
      message: 'Give a title or a description',
    }),
  validateInRun: true,
  label: () => 'Renaming dashboard…',
  async run(host, input) {
    current(host);
    const chip =
      input.title !== undefined
        ? `Renamed dashboard to ${quoted(input.title)}`
        : 'Updated dashboard description';
    const { dashboard } = mutate(
      host,
      chip,
      () => chip,
      (draft) => {
        if (input.title !== undefined) draft.title = input.title;
        if (input.description !== undefined) draft.description = input.description;
      },
    );
    return { result: { title: dashboard.title, version: dashboard.version }, summary: chip, chip };
  },
});

/**
 * F19 auto-title fallback: renames the current dashboard as a normal change of the turn (it
 * extends the turn's change set, so Undo reverts it), emits `dashboard_changed` and records the
 * chip. Throws a `ToolFailure` / store error like the tools do.
 */
export function autoRenameDashboard(host: ToolHost, title: string): Dashboard {
  const chip = `Renamed dashboard: ${title}`;
  const { dashboard } = mutate(
    host,
    chip,
    () => chip,
    (draft) => void (draft.title = title),
  );
  (host.turn ??= newTurnState()).chips.push({
    tool: 'rename_dashboard',
    label: chip.slice(0, 120),
    status: 'ok',
  });
  return dashboard;
}

/** Not sorted here; `assistant-tools.ts` sorts the whole list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DASHBOARD_SPECS: ToolSpec<any>[] = [
  addWidget,
  arrangeWidgets,
  createDashboard,
  getDashboard,
  previewWidget,
  removeWidget,
  renameDashboard,
  updateWidget,
];

export const DASHBOARD_TOOL_NAMES = DASHBOARD_SPECS.map((s) => s.name);
