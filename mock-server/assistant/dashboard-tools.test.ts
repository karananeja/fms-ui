// @vitest-environment node
import {
  chatEventSchema,
  dashboardChatRequestSchema,
  KPI_METRICS,
  TIME_RANGES,
  VEHICLE_LIST_COLUMNS,
  WIDGET_TYPES,
  widgetToolInputSchema,
  type ChatEvent,
  type Dashboard,
} from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer } from '../testing/harness.ts';
import { requestPrefix } from './assistant-runner.ts';
import { buildTools, toolDefinitions } from './assistant-tools.ts';
import { CATALOGUE_EXAMPLES, CATALOGUE_PROMPT } from './catalogue-prompt.ts';
import { threadToMessages } from './dashboard-chat.ts';
import { ReportStore } from './reports.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';
import { newTurnState, type ChatMode, type ToolHost } from './tool-kit.ts';

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());

type Who = 'ops' | 'superadmin' | 'viewer';
const userOf = (k: Who) => server.ctx.accounts.user(`u-${k}`);

function host(k: Who, mode: ChatMode = { kind: 'global' }, events: ChatEvent[] = []): ToolHost {
  const user = userOf(k);
  return {
    ctx: server.ctx,
    user,
    permissions: server.ctx.accounts.permissions(user),
    api: async (path) => {
      const r = await server.app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: cookies[k] },
      });
      return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as unknown) : null };
    },
    reports: new ReportStore(() => server.ctx.clock.now()),
    emit: (e) => events.push(e),
    entities: new Map(),
    logError: () => {},
    mode,
    turn: newTurnState(),
  };
}

async function call(h: ToolHost, name: string, input: unknown) {
  const tool = buildTools(h).find((t) => t.name === name)!;
  try {
    const out = (await tool.run(tool.parse(input))) as string;
    return { ok: true as const, json: JSON.parse(out) as Record<string, unknown>, error: '' };
  } catch (err) {
    return {
      ok: false as const,
      json: {} as Record<string, unknown>,
      error: String((err as { content?: unknown }).content ?? err),
    };
  }
}

const dash = (k: Who, id: string): Dashboard => server.ctx.dashboards.get(userOf(k).id, id);
const inDash = (id: string): ChatMode => ({ kind: 'dashboard', dashboardId: id });
const northFleet = () => [...server.ctx.tree.byId.values()].find((f) => f.name === 'North')!;

const THREE: Record<string, unknown>[] = [
  { type: 'kpi', title: 'Running vehicles', source: 'live', status: 'running' },
  { type: 'status-breakdown', title: 'Running vs stopped', display: 'donut', fleetId: 'North' },
  {
    type: 'ranking',
    title: 'Top idle vehicles',
    entity: 'vehicles',
    metric: 'idleMs',
    order: 'desc',
    limit: 10,
    range: '7d',
  },
];

describe('F19-T1 contract', () => {
  it('widgetToolInput accepts all 8 types and rejects iframe, html and id', () => {
    for (const t of WIDGET_TYPES)
      expect(widgetToolInputSchema.safeParse(CATALOGUE_EXAMPLES[t]).success, t).toBe(true);
    expect(widgetToolInputSchema.safeParse({ type: 'iframe', title: 'x' }).success).toBe(false);
    expect(
      widgetToolInputSchema.safeParse({ ...CATALOGUE_EXAMPLES.text, html: '<b>x</b>' }).success,
    ).toBe(false);
    expect(widgetToolInputSchema.safeParse({ ...CATALOGUE_EXAMPLES.text, id: 'w-1' }).success).toBe(
      false,
    );
  });

  it('dashboard chat request and the new events parse / reject', () => {
    expect(dashboardChatRequestSchema.parse({ message: '  hi ' })).toEqual({ message: 'hi' });
    expect(dashboardChatRequestSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(dashboardChatRequestSchema.safeParse({ message: 'x'.repeat(4001) }).success).toBe(false);
    expect(dashboardChatRequestSchema.safeParse({ message: 'hi', messages: [] }).success).toBe(
      false,
    );
    expect(chatEventSchema.safeParse({ type: 'thread_saved', messages: [] }).success).toBe(true);
    expect(
      chatEventSchema.safeParse({ type: 'dashboard_created', dashboard: {}, url: '/x' }).success,
    ).toBe(false);
    expect(
      chatEventSchema.safeParse({ type: 'dashboard_changed', dashboardId: 'd', changeId: 'c' })
        .success,
    ).toBe(false);
  });
});

describe('F19-T2 prompt and caching', () => {
  const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

  it('the catalogue names every widget type and enum value', () => {
    for (const v of [
      ...WIDGET_TYPES,
      ...KPI_METRICS,
      ...TIME_RANGES,
      ...VEHICLE_STATUSES,
      ...VEHICLE_LIST_COLUMNS,
    ])
      expect(CATALOGUE_PROMPT, v).toContain(v);
    expect(SYSTEM_PROMPT).toContain(CATALOGUE_PROMPT);
    expect(SYSTEM_PROMPT).toContain("only the signed-in user's own dashboards");
  });

  it('16 tool definitions (D-135 preview_widget) + system prompt are byte-identical across users and chat modes', () => {
    const a = toolDefinitions(buildTools(host('ops')));
    const b = toolDefinitions(buildTools(host('superadmin', inDash('dash-x'))));
    expect(a).toHaveLength(16);
    expect(digest(a)).toBe(digest(b));
    expect(digest(requestPrefix())).toBe(digest(requestPrefix()));
    const prefix = JSON.stringify({ tools: a, system: SYSTEM_PROMPT });
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prefix).not.toMatch(/\b\d{10,13}\b/);
    expect(prefix).not.toMatch(/Ops User|u-ops|dash-[0-9a-f]{8}|North/);
    // Strict-safe schemas: no numeric/length bounds or oneOf in the dashboard tools.
    const create = JSON.stringify(
      a.find((t) => (t as { name: string }).name === 'create_dashboard'),
    );
    expect(create).not.toMatch(/"(minimum|maximum|maxLength|minLength|oneOf|pattern)"/);
    expect((a as { strict: boolean }[]).every((t) => t.strict)).toBe(true);
  });

  it('<dashboard> goes in the latest user turn only, <context> in the first', () => {
    const m = (seq: number, role: 'user' | 'assistant', text: string) => ({
      id: `m${seq}`,
      seq,
      role,
      text,
      chips: [],
      change:
        role === 'assistant' && seq === 2
          ? {
              id: 'c1',
              summary: 'Added widget "A" (w-1)',
              beforeVersion: 1,
              afterVersion: 2,
              undoneAt: 5,
              undoable: false,
            }
          : null,
      previews: [],
      createdAt: 0,
    });
    const msgs = threadToMessages(
      [m(1, 'user', 'q1'), m(2, 'assistant', 'a1'), m(3, 'user', 'q2')],
      '<context>C</context>',
      '<dashboard>D</dashboard>',
    );
    expect(msgs[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '<context>C</context>' },
        { type: 'text', text: 'q1' },
      ],
    });
    expect(msgs[1]!.content).toBe(
      'a1\n\n[Changes: Added widget "A" (w-1)]\n[The user undid these changes]',
    );
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '<dashboard>D</dashboard>' },
        { type: 'text', text: 'q2' },
      ],
    });
  });
});

describe('F19-T3 tools on the store (as ops)', () => {
  it('create, get, add, update, remove, arrange, rename; names resolved; one change set per turn', async () => {
    const events: ChatEvent[] = [];
    const g = host('ops', { kind: 'global' }, events);
    const created = await call(g, 'create_dashboard', { title: 'Ops today', widgets: THREE });
    expect(created.ok).toBe(true);
    const id = created.json.dashboardId as string;
    expect(created.json.url).toBe(`/dashboards/${id}`);
    expect(created.json.widgets).toHaveLength(3);
    expect(events.some((e) => e.type === 'dashboard_created')).toBe(true);
    expect(g.turn!.chips.at(-1)).toEqual({
      tool: 'create_dashboard',
      label: 'Created dashboard "Ops today" (3 widgets)',
      status: 'ok',
    });
    // Fleet name → id.
    const sb = dash('ops', id).widgets.find((w) => w.type === 'status-breakdown')!;
    expect(sb).toMatchObject({ fleetId: northFleet().id });

    expect((await call(g, 'get_dashboard', { dashboard: id })).json.title).toBe('Ops today');
    expect((await call(g, 'get_dashboard', { dashboard: 'ops tod' })).json.id).toBe(id);

    const h = host('ops', inDash(id), events);
    const v1 = dash('ops', id).version;
    const add = await call(h, 'add_widget', { widget: CATALOGUE_EXAMPLES.text });
    expect(add.ok).toBe(true);
    const ranking = dash('ops', id).widgets.find((w) => w.type === 'ranking')!;
    const upd = await call(h, 'update_widget', {
      widgetId: ranking.id,
      widget: { ...THREE[2], range: '30d' },
    });
    expect(upd.ok).toBe(true);
    expect(dash('ops', id).widgets.find((w) => w.id === ranking.id)).toMatchObject({
      range: '30d',
    });
    // Type change keeps the id and slot.
    const typeChange = await call(h, 'update_widget', {
      widgetId: add.json.widgetId,
      widget: CATALOGUE_EXAMPLES['daily-chart'],
    });
    expect(typeChange.ok).toBe(true);
    const changed = dash('ops', id);
    expect(changed.widgets.find((w) => w.id === add.json.widgetId)!.type).toBe('daily-chart');
    expect(changed.layout.lg.find((i) => i.i === add.json.widgetId)!.w).toBeGreaterThanOrEqual(4);

    const kpi = changed.widgets.find((w) => w.type === 'kpi')!;
    expect((await call(h, 'remove_widget', { widgetIds: [kpi.id] })).ok).toBe(true);
    const order = dash('ops', id)
      .widgets.map((w) => w.id)
      .reverse();
    const arr = await call(h, 'arrange_widgets', {
      order,
      sizes: [{ widgetId: order[0], w: 12, h: 1 }],
    });
    expect(arr.ok).toBe(true);
    const arranged = dash('ops', id);
    expect(arr.json.order).toEqual(order);
    expect(arranged.layout.lg[0]).toMatchObject({ i: order[0], x: 0, y: 0, w: 12 });
    expect(arranged.layout.lg[0]!.h).toBeGreaterThan(1); // clamped to the type's minimum
    expect(arranged.layout.md.map((i) => i.i)).toEqual(order);
    expect(arranged.layout.md.every((i) => i.w <= 6)).toBe(true);
    expect(arranged.layout.sm.every((i) => i.w === 1 && i.x === 0)).toBe(true);
    expect((await call(h, 'rename_dashboard', { title: 'Ops now' })).ok).toBe(true);
    expect(dash('ops', id).title).toBe('Ops now');

    // 6 mutations in one turn → one change set, extended.
    const changes = events.filter(
      (e): e is Extract<ChatEvent, { type: 'dashboard_changed' }> => e.type === 'dashboard_changed',
    );
    expect(changes).toHaveLength(6);
    expect(new Set(changes.map((c) => c.changeId)).size).toBe(1);
    expect(changes.map((c) => c.version)).toEqual([v1 + 1, v1 + 2, v1 + 3, v1 + 4, v1 + 5, v1 + 6]);
    expect(changes.at(-1)!.summary).toContain('Added widget "Notes"');
    expect(changes.at(-1)!.summary).toContain('Renamed dashboard to "Ops now"');
    expect(h.turn!.changeId).toBe(changes[0]!.changeId);
    // Undo of the turn restores the dashboard as it was before the turn.
    const undone = server.ctx.dashboards.undo('u-ops', id, h.turn!.changeId!, v1 + 6);
    expect(undone.title).toBe('Ops today');
    expect(undone.widgets).toHaveLength(3);
  });

  it('scope, permission and limit errors', async () => {
    const g = host('ops');
    const id = (await call(g, 'create_dashboard', { title: 'Limits' })).json.dashboardId as string;
    const h = host('ops', inDash(id));
    expect(
      (await call(h, 'add_widget', { widget: { ...THREE[1], fleetId: 'South' } })).error,
    ).toMatch(/Fleet "South" was not found/);
    const { sim, tree } = server.ctx;
    const outside = [...Array(sim.count).keys()].find(
      (n) => !tree.inScope(sim.fleetId(n), userOf('ops').fleetIds),
    )!;
    const vehicleKpi = {
      ...CATALOGUE_EXAMPLES.kpi,
      source: 'analytics',
      metric: 'distanceKm',
      range: '7d',
    };
    delete (vehicleKpi as Record<string, unknown>).status;
    expect(
      (await call(h, 'add_widget', { widget: { ...vehicleKpi, vehicleId: sim.regno(outside) } }))
        .error,
    ).toMatch(/not found/);
    const notPermitted = await call(h, 'add_widget', { widget: CATALOGUE_EXAMPLES['driver-list'] });
    expect(notPermitted.error).toMatch(/Not permitted: .*driver-list.*drivers\.manage/);
    expect(h.turn!.chips.at(-1)).toMatchObject({ tool: 'add_widget', status: 'error' });
    const bad = await call(h, 'add_widget', { widget: { type: 'iframe', title: 'x' } });
    expect(bad.error).toMatch(/Invalid input: widget/);
    expect(dash('ops', id).version).toBe(1);

    for (let k = 0; k < 24; k++)
      expect(
        (await call(h, 'add_widget', { widget: { ...CATALOGUE_EXAMPLES.text, title: `n${k}` } }))
          .ok,
      ).toBe(true);
    expect((await call(h, 'add_widget', { widget: CATALOGUE_EXAMPLES.text })).error).toBe(
      'This dashboard already has 24 widgets (the maximum).',
    );
  });

  it('a PATCH between two calls starts a new change set; undo keeps the PATCH', async () => {
    const id = (await call(host('ops'), 'create_dashboard', { title: 'Races', widgets: THREE }))
      .json.dashboardId as string;
    const h = host('ops', inDash(id));
    await call(h, 'rename_dashboard', { title: 'First' });
    const first = h.turn!.changeId;
    const d = dash('ops', id);
    server.ctx.dashboards.update('u-ops', id, { version: d.version, description: 'manual edit' });
    await call(h, 'add_widget', { widget: CATALOGUE_EXAMPLES.text });
    expect(h.turn!.changeId).not.toBe(first);
    const now = dash('ops', id);
    const undone = server.ctx.dashboards.undo('u-ops', id, h.turn!.changeId!, now.version);
    expect(undone.description).toBe('manual edit');
    expect(undone.title).toBe('First');
    expect(undone.widgets).toHaveLength(3);
  });
});

describe('F19-T4 scope test (intent)', () => {
  it("ops can't read or change superadmin's dashboards, shared or not; global can't mutate", async () => {
    const sa = host('superadmin');
    const own = (await call(sa, 'create_dashboard', { title: 'SA private', widgets: THREE })).json
      .dashboardId as string;
    const shared = (await call(sa, 'create_dashboard', { title: 'SA shared', widgets: THREE })).json
      .dashboardId as string;
    server.ctx.dashboards.addShares('u-superadmin', shared, ['u-ops']);
    const versions = () => [own, shared].map((id) => dash('superadmin', id).version);
    const before = versions();
    for (const id of [own, shared]) {
      const g = host('ops');
      expect((await call(g, 'get_dashboard', { dashboard: id })).error).toMatch(
        /not found among your dashboards/,
      );
      expect((await call(g, 'get_dashboard', { dashboard: 'SA ' })).error).toMatch(/not found/);
      const h = host('ops', inDash(id));
      expect((await call(h, 'get_dashboard', {})).error).toMatch(/not found among your dashboards/);
      expect((await call(h, 'rename_dashboard', { title: 'hacked' })).error).toMatch(/not found/);
      expect((await call(h, 'add_widget', { widget: CATALOGUE_EXAMPLES.text })).error).toMatch(
        /not found/,
      );
      expect(
        (await call(h, 'remove_widget', { widgetIds: [dash('superadmin', id).widgets[0]!.id] }))
          .error,
      ).toMatch(/not found/);
    }
    expect(versions()).toEqual(before);
    // The global chat only creates and reads.
    const mine = (await call(host('ops'), 'create_dashboard', { title: 'Mine' })).json
      .dashboardId as string;
    expect((await call(host('ops'), 'rename_dashboard', { title: 'x' })).error).toMatch(
      /dashboard's own chat.*\/dashboards\/<id>/,
    );
    expect(dash('ops', mine).title).toBe('Mine');
    // No dashboards.use → not permitted.
    expect((await call(host('viewer'), 'create_dashboard', { title: 'x' })).error).toMatch(
      /Not permitted/,
    );
  });
});
