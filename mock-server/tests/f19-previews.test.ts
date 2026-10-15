// @vitest-environment node
import {
  chatEventSchema,
  dashboardSchema,
  dashboardThreadSchema,
  widgetPreviewSchema,
  type ChatEvent,
  type Dashboard,
  type DashboardThread,
  type WidgetPreview,
} from '@shared/contract/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTools } from '../assistant/assistant-tools.ts';
import { CATALOGUE_EXAMPLES } from '../assistant/catalogue-prompt.ts';
import { ruleScript } from '../assistant/fake-model.ts';
import { ReportStore } from '../assistant/reports.ts';
import { SYSTEM_PROMPT } from '../assistant/system-prompt.ts';
import { newTurnState, type ChatMode, type ToolHost } from '../assistant/tool-kit.ts';
import { openDatabase } from '../db/database.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** D-135 widget previews in chat: P-T1 tool, P-T2 storage + endpoint + migration, P-T3 fake model. */

process.env.FMS_ASSISTANT_FAKE = '1';
delete process.env.FMS_ASSISTANT_PROVIDER;

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;
const dir = mkdtempSync(join(tmpdir(), 'fms-previews-'));

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

type Who = 'ops' | 'superadmin' | 'viewer';
const userOf = (k: Who) => server.ctx.accounts.user(`u-${k}`);

function host(k: Who, mode: ChatMode = { kind: 'global' }, events: ChatEvent[] = []): ToolHost {
  const user = userOf(k);
  return {
    ctx: server.ctx,
    user,
    permissions: server.ctx.accounts.permissions(user),
    api: async () => ({ status: 500, body: null }),
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

async function sse(path: string, body: unknown, cookie: string, onEvent?: (e: ChatEvent) => void) {
  const res = await fetch(server.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const events: ChatEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let k: number;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, k);
      buf = buf.slice(k + 2);
      if (!line.startsWith('data: ')) continue;
      const e = chatEventSchema.parse(JSON.parse(line.slice(6)));
      events.push(e);
      onEvent?.(e);
    }
  }
  return events;
}

const chat = (id: string, message: string, onEvent?: (e: ChatEvent) => void) =>
  sse(`/api/dashboards/${id}/chat`, { message }, cookies.ops, onEvent);
const previewsOf = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'widget_preview' ? [e.preview] : []));
const toolsOf = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'tool_start' ? [e.name] : []));

async function newDashboard(cookie = cookies.ops, title = 'Preview test'): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: { title },
    cookie,
    schema: dashboardSchema,
  });
  return res.body;
}
const thread = async (id: string) =>
  (
    await server.api('GET', `/api/dashboards/${id}/thread`, {
      cookie: cookies.ops,
      schema: dashboardThreadSchema,
    })
  ).body as DashboardThread;
const patchPreview = (id: string, previewId: string, body: unknown, cookie = cookies.ops) =>
  server.api('PATCH', `/api/dashboards/${id}/previews/${previewId}`, {
    body,
    cookie,
    schema: z.unknown(),
  });

describe('P-T1 preview_widget validates like add_widget and does not mutate', () => {
  it('valid widget → previewId + widget with a fresh id, widget_preview event, same version', async () => {
    const d = await newDashboard();
    const events: ChatEvent[] = [];
    const h = host('ops', { kind: 'dashboard', dashboardId: d.id }, events);
    const r = await call(h, 'preview_widget', {
      widget: { ...CATALOGUE_EXAMPLES['status-breakdown'], fleetId: 'North' },
    });
    expect(r.ok).toBe(true);
    const widget = r.json.widget as { id: string; fleetId: string };
    expect(r.json.previewId).toMatch(/^pv-[0-9a-f]+$/);
    expect(widget.id).toMatch(/^w-[0-9a-f]+$/);
    expect(widget.fleetId).not.toBe('North'); // resolved to the fleet id
    const ev = widgetPreviewSchema.parse(previewsOf(events)[0]);
    expect(ev).toMatchObject({
      id: r.json.previewId,
      dashboardId: d.id,
      status: 'pending',
      size: { w: 4, h: 4 },
      widget: { id: widget.id },
    });
    expect(h.turn!.previews).toHaveLength(1);
    expect(h.turn!.chips.at(-1)).toMatchObject({ tool: 'preview_widget', status: 'ok' });
    expect(events.some((e) => e.type === 'dashboard_changed')).toBe(false);
    const after = server.ctx.dashboards.get(userOf('ops').id, d.id);
    expect(after.version).toBe(d.version);
    expect(after.widgets).toHaveLength(0);
  });

  it('bad widget → error with paths; not permitted → error; nothing changes', async () => {
    const d = await newDashboard();
    const h = host('ops', { kind: 'dashboard', dashboardId: d.id });
    const bad = await call(h, 'preview_widget', { widget: { type: 'iframe', title: 'x' } });
    expect(bad.error).toMatch(/Invalid input: widget/);
    const missing = await call(h, 'preview_widget', {
      widget: { type: 'kpi', title: 'x', source: 'live' },
    });
    expect(missing.error).toMatch(/widget\.status/);
    const denied = await call(h, 'preview_widget', { widget: CATALOGUE_EXAMPLES['driver-list'] });
    expect(denied.error).toMatch(/Not permitted: .*driver-list.*drivers\.manage/);
    expect(h.turn!.chips.map((c) => c.status)).toEqual(['error', 'error', 'error']);
    expect(h.turn!.previews).toHaveLength(0);
    expect(server.ctx.dashboards.get(userOf('ops').id, d.id).version).toBe(1);
  });

  it('global chat: dashboardId optional (null) or one of mine; no dashboards.use → not permitted', async () => {
    const d = await newDashboard();
    const events: ChatEvent[] = [];
    const g = host('ops', { kind: 'global' }, events);
    expect((await call(g, 'preview_widget', { widget: CATALOGUE_EXAMPLES.kpi })).ok).toBe(true);
    expect(
      (await call(g, 'preview_widget', { dashboardId: d.id, widget: CATALOGUE_EXAMPLES.kpi })).ok,
    ).toBe(true);
    expect(previewsOf(events).map((p) => p.dashboardId)).toEqual([null, d.id]);
    const sa = await newDashboard(cookies.superadmin, 'Not yours');
    expect(
      (await call(g, 'preview_widget', { dashboardId: sa.id, widget: CATALOGUE_EXAMPLES.kpi }))
        .error,
    ).toMatch(/not found among your dashboards/);
    expect(
      (await call(host('viewer'), 'preview_widget', { widget: CATALOGUE_EXAMPLES.text })).error,
    ).toMatch(/Not permitted/);
  });

  it('the system prompt routes single widgets to preview_widget', () => {
    expect(SYSTEM_PROMPT).toContain('call preview_widget instead of add_widget');
    expect(SYSTEM_PROMPT).toMatch(/Multi-widget builds .* use the mutating tools/);
  });
});

describe('P-T2 previews on the thread + PATCH …/previews/:previewId', () => {
  it('stored on the assistant message, returned by GET thread, status set by PATCH', async () => {
    const d = await newDashboard();
    const events = await chat(d.id, 'add a small KPI of running vehicles');
    const [p] = previewsOf(events);
    expect(p).toMatchObject({ dashboardId: d.id, status: 'pending', widget: { type: 'kpi' } });
    const saved = events.find((e) => e.type === 'thread_saved') as Extract<
      ChatEvent,
      { type: 'thread_saved' }
    >;
    expect(saved.messages[0]!.previews).toEqual([]);
    expect(saved.messages[1]!.previews).toEqual([p]);
    expect((await thread(d.id)).messages[1]!.previews).toEqual([p]);

    const ok = await patchPreview(d.id, p!.id, { status: 'added' });
    expect(ok.status).toBe(200);
    expect(widgetPreviewSchema.parse(ok.body)).toMatchObject({ id: p!.id, status: 'added' });
    expect((await thread(d.id)).messages[1]!.previews[0]!.status).toBe('added');
    expect((await patchPreview(d.id, p!.id, { status: 'discarded' })).status).toBe(200);
    expect((await thread(d.id)).messages[1]!.previews[0]!.status).toBe('discarded');
    // The dashboard itself is untouched (adding is the client's own PATCH).
    expect(server.ctx.dashboards.get(userOf('ops').id, d.id).version).toBe(1);

    // The next transcript notes the preview without its status.
    await chat(d.id, 'thanks');
    const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
      body: unknown;
    };
    expect(JSON.stringify(last.body)).toContain('[Previewed widget (not on the dashboard): ');
  });

  it('guards: 422 body, 404 unknown preview / stranger, 403 viewer and no dashboards.use, 409 chat_busy', async () => {
    const d = await newDashboard();
    const [p] = previewsOf(await chat(d.id, '[fake:preview]'));
    expect((await patchPreview(d.id, p!.id, { status: 'pending' })).status).toBe(422);
    expect((await patchPreview(d.id, p!.id, { status: 'added', x: 1 })).status).toBe(422);
    expect((await patchPreview(d.id, 'pv-nope', { status: 'added' })).status).toBe(404);
    expect((await patchPreview('dash-nope', p!.id, { status: 'added' })).status).toBe(404);
    expect((await patchPreview(d.id, p!.id, { status: 'added' }, cookies.superadmin)).status).toBe(
      404,
    );
    expect((await patchPreview(d.id, p!.id, { status: 'added' }, cookies.viewer)).status).toBe(403);
    server.ctx.dashboards.addShares(userOf('ops').id, d.id, [userOf('superadmin').id]);
    const shared = await patchPreview(d.id, p!.id, { status: 'added' }, cookies.superadmin);
    expect(shared.status).toBe(403);
    expect(shared.body).toMatchObject({ error: { code: 'forbidden' } });

    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    await server.api('POST', '/api/dev/assistant/script', {
      body: {
        steps: [{ text: Array.from({ length: 20 }, (_, k) => `w${k}`).join(' '), delayMs: 40 }],
      },
      schema: z.unknown(),
      cookie: cookies.ops,
    });
    const slow = chat(d.id, 'slowly', (e) => e.type === 'text' && started());
    await streaming;
    const busy = await patchPreview(d.id, p!.id, { status: 'added' });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: { code: 'chat_busy' } });
    await slow;
    expect((await patchPreview(d.id, p!.id, { status: 'added' })).status).toBe(200);
  });

  it('migration 2 runs on an F18 (v1) DB file without loss; old rows read as []', () => {
    const path = join(dir, 'f18.db');
    const v1 = openDatabase(path, MIGRATIONS.slice(0, 1));
    v1.exec(`
      INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at)
        VALUES ('d1', 'u', 't', '[]', '{"lg":[],"md":[],"sm":[]}', 0, 0);
      INSERT INTO dashboard_messages (id, dashboard_id, seq, role, text, chips, created_at)
        VALUES ('m1', 'd1', 1, 'assistant', 'hello', '[{"tool":"x","label":"y","status":"ok"}]', 5);
    `);
    v1.close();
    const db = openDatabase(path);
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: 2 });
    expect(db.prepare('SELECT * FROM dashboard_messages').all()).toEqual([
      {
        id: 'm1',
        dashboard_id: 'd1',
        seq: 1,
        role: 'assistant',
        text: 'hello',
        chips: '[{"tool":"x","label":"y","status":"ok"}]',
        change_id: null,
        created_at: 5,
        previews_json: '[]',
      },
    ]);
    expect(() =>
      db.exec("UPDATE dashboard_messages SET previews_json = 'not json' WHERE id = 'm1'"),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe('P-T3 fake model: single widget → preview_widget, builds → mutating tools', () => {
  const firstTools = (q: string, dash?: object) => {
    const raw = dash ? `<dashboard>${JSON.stringify(dash)}</dashboard>\n${q}` : q;
    const step = ruleScript(raw).steps[0]!;
    return 'tools' in step ? step.tools.map((t) => t.name) : [];
  };

  it('rules in both chats', () => {
    const empty = { id: 'dash-x', widgets: [] };
    expect(firstTools('add a small KPI of running vehicles', empty)).toEqual(['preview_widget']);
    expect(firstTools('add a small KPI of running vehicles')).toEqual(['preview_widget']);
    expect(firstTools('add a stopped vehicles widget', empty)).toEqual(['preview_widget']);
    expect(firstTools('[fake:preview]')).toEqual(['preview_widget']);
    expect(firstTools('build me a fleet health dashboard', empty)).toEqual([
      'add_widget',
      'add_widget',
      'add_widget',
    ]);
    expect(firstTools('build me a fleet health dashboard')).toEqual(['create_dashboard']);
    expect(firstTools('add a note', empty)).toEqual(['add_widget']);
  });

  async function scenario(provider: 'anthropic' | 'openai') {
    process.env.FMS_ASSISTANT_PROVIDER = provider;
    try {
      const d = await newDashboard();
      const single = await chat(d.id, 'add a small KPI of running vehicles');
      const build = await chat(d.id, 'build me a fleet health dashboard');
      const global = await sse(
        '/api/chat',
        { messages: [{ role: 'user', content: 'add a small KPI of running vehicles' }] },
        cookies.ops,
      );
      return { d, single, build, global };
    } finally {
      delete process.env.FMS_ASSISTANT_PROVIDER;
    }
  }

  for (const provider of ['anthropic', 'openai'] as const)
    it(`same events through the ${provider} path`, async () => {
      const { d, single, build, global } = await scenario(provider);
      expect(toolsOf(single)).toEqual(['preview_widget']);
      const [p] = previewsOf(single) as WidgetPreview[];
      expect(p).toMatchObject({
        dashboardId: d.id,
        widget: { type: 'kpi', source: 'live', status: 'running', title: 'Running vehicles' },
        size: { w: 3, h: 2 },
      });
      expect(single.some((e) => e.type === 'dashboard_changed')).toBe(false);
      expect(single.at(-1)!.type).toBe('done');
      expect(toolsOf(build)).toEqual(['add_widget', 'add_widget', 'add_widget']);
      expect(build.filter((e) => e.type === 'dashboard_changed')).toHaveLength(3);
      expect(previewsOf(build)).toEqual([]);
      expect(toolsOf(global)).toEqual(['preview_widget']);
      expect(previewsOf(global)[0]).toMatchObject({ dashboardId: null, status: 'pending' });
      expect((await thread(d.id)).messages.map((m) => m.previews.length)).toEqual([0, 1, 0, 0]);
    });
});
