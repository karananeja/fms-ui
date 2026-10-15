// @vitest-environment node
import {
  chatEventSchema,
  dashboardSchema,
  dashboardThreadSchema,
  type ChatEvent,
  type Dashboard,
  type DashboardThread,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SEED_USERS, startServer } from '../testing/harness.ts';

process.env.FMS_ASSISTANT_FAKE = '1';

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());

/** POSTs to an SSE endpoint and returns every event (validated against the contract). */
async function sse(
  path: string,
  body: unknown,
  cookie: string,
  opts: { signal?: AbortSignal; onEvent?: (e: ChatEvent) => void } = {},
) {
  const res = await fetch(server.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  expect(res.status).toBe(200);
  const events: ChatEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
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
        opts.onEvent?.(e);
      }
    }
  } catch (err) {
    if (!opts.signal?.aborted) throw err;
  }
  return events;
}

const chat = (id: string, message: string, cookie = cookies.ops, opts = {}) =>
  sse(`/api/dashboards/${id}/chat`, { message }, cookie, opts);
const text = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

async function newDashboard(cookie = cookies.ops, title = 'Chat test'): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: { title },
    cookie,
    schema: dashboardSchema,
  });
  expect(res.status).toBe(201);
  return res.body;
}
const thread = async (id: string, cookie = cookies.ops) =>
  (
    await server.api('GET', `/api/dashboards/${id}/thread`, {
      cookie,
      schema: dashboardThreadSchema,
    })
  ).body as DashboardThread;
const getDash = async (id: string) =>
  (
    await server.api('GET', `/api/dashboards/${id}`, {
      cookie: cookies.ops,
      schema: dashboardSchema,
    })
  ).body as Dashboard;
const undo = (id: string, changeId: string, version: number) =>
  server.api('POST', `/api/dashboards/${id}/changes/${changeId}/undo`, {
    body: { version },
    cookie: cookies.ops,
    schema: dashboardSchema,
  });
const script = (body: unknown) =>
  server.api('POST', '/api/dev/assistant/script', {
    body,
    schema: z.unknown(),
    cookie: cookies.ops,
  });
const lastRequest = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    body: { messages: { role: string; content: string | { type: string; text: string }[] }[] };
  };
async function idle() {
  for (let k = 0; k < 100; k++) {
    const s = (await (await fetch(`${server.base}/api/dev/assistant/stats`)).json()) as {
      activeRuns: number;
    };
    if (s.activeRuns === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('runs did not finish');
}

describe('F19-T5 POST /api/dashboards/:id/chat', () => {
  it('build turn: event order, versions, thread_saved, thread chips, undo', async () => {
    const d = await newDashboard();
    const events = await chat(
      d.id,
      'Build this dashboard: running vs stopped and top idle vehicles',
    );
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'dashboard_changed')).toHaveLength(3);
    const firstChange = types.indexOf('dashboard_changed');
    expect(types.indexOf('tool_start')).toBeLessThan(firstChange);
    expect(types.lastIndexOf('tool_end')).toBeGreaterThan(firstChange);
    expect(types.indexOf('text')).toBeGreaterThan(types.lastIndexOf('tool_end'));
    expect(types.at(-2)).toBe('thread_saved');
    expect(types.at(-1)).toBe('done');
    const changes = events.filter(
      (e): e is Extract<ChatEvent, { type: 'dashboard_changed' }> => e.type === 'dashboard_changed',
    );
    expect(changes.map((c) => c.version)).toEqual([2, 3, 4]);
    expect(new Set(changes.map((c) => c.changeId)).size).toBe(1);
    expect(changes.at(-1)!.dashboard.widgets).toHaveLength(3);
    const saved = events.find((e) => e.type === 'thread_saved') as Extract<
      ChatEvent,
      { type: 'thread_saved' }
    >;
    expect(saved.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved.messages[1]!.chips.map((c) => c.label)).toEqual([
      'Added widget: Running vehicles',
      'Added widget: Running vs stopped',
      'Added widget: Top idle vehicles',
    ]);
    expect(saved.messages[1]!.change).toMatchObject({ id: changes[0]!.changeId, undoable: true });

    const t = await thread(d.id);
    expect(t.messages).toHaveLength(2);
    expect(t.messages[1]!.change!.undoable).toBe(true);
    const res = await undo(d.id, changes[0]!.changeId, 4);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 5, widgets: [] });
    expect((await thread(d.id)).messages[1]!.change).toMatchObject({ undoable: false });
    expect((await thread(d.id)).messages[1]!.change!.undoneAt).not.toBeNull();
  });

  it('guards: 401, 403 without dashboards.use, 403 for a viewer of a shared dashboard, 404, 422', async () => {
    const d = await newDashboard();
    const body = { message: 'hi' };
    const post = (cookie?: string, id = d.id, b: unknown = body) =>
      server.api('POST', `/api/dashboards/${id}/chat`, { body: b, cookie });
    expect((await post()).status).toBe(401);
    expect((await post(cookies.viewer)).status).toBe(403);
    expect((await post(cookies.ops, 'dash-nope')).status).toBe(404);
    expect((await post(cookies.superadmin)).status).toBe(404);
    expect((await post(cookies.ops, d.id, { message: '  ' })).status).toBe(422);
    const sa = await newDashboard(cookies.superadmin, 'SA');
    server.ctx.dashboards.addShares('u-superadmin', sa.id, ['u-ops']);
    const viewer = await post(cookies.ops, sa.id);
    expect(viewer.status).toBe(403);
    expect(viewer.body).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('one turn per dashboard: a second turn and an undo get 409 chat_busy', async () => {
    const d = await newDashboard();
    const built = await chat(d.id, 'build it');
    const change = built.find((e) => e.type === 'dashboard_changed') as Extract<
      ChatEvent,
      { type: 'dashboard_changed' }
    >;
    const controller = new AbortController();
    let started!: () => void;
    const streaming = new Promise<void>((r) => (started = r));
    const first = chat(d.id, '[fake:slow]', cookies.ops, {
      signal: controller.signal,
      onEvent: (e: ChatEvent) => e.type === 'text' && started(),
    });
    await streaming;
    const second = await server.api('POST', `/api/dashboards/${d.id}/chat`, {
      body: { message: 'hi' },
      cookie: cookies.ops,
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'chat_busy' } });
    const u = await undo(d.id, change.changeId, 4);
    expect(u.status).toBe(409);
    expect(u.body).toMatchObject({ error: { code: 'chat_busy' } });
    controller.abort();
    await first;
    await idle();
    expect((await chat(d.id, 'hello')).at(-1)!.type).toBe('done');
  });
});

describe('F19-T6 resume: transcript rebuilt from the thread', () => {
  it('carries earlier turns, change notes and undo notes; context in the first turn only', async () => {
    const d = await newDashboard();
    const built = await chat(d.id, 'build it');
    const change = built.find((e) => e.type === 'dashboard_changed') as Extract<
      ChatEvent,
      { type: 'dashboard_changed' }
    >;
    await chat(d.id, 'how are we doing?');
    const msgs = (await lastRequest()).body.messages;
    const flat = (m: (typeof msgs)[number]) =>
      typeof m.content === 'string' ? m.content : m.content.map((b) => b.text).join('\n');
    expect(flat(msgs[0]!)).toContain('<context>');
    expect(flat(msgs[0]!)).toContain('build it');
    expect(flat(msgs[0]!)).not.toContain('<dashboard>');
    expect(flat(msgs[1]!)).toMatch(/\[Changes: Added widget "Running vehicles" \(w-[0-9a-f]+\); /);
    expect(flat(msgs[2]!)).toContain('<dashboard>');
    expect(flat(msgs[2]!)).not.toContain('<context>');
    expect(flat(msgs[2]!)).toContain('how are we doing?');
    expect(msgs.filter((m) => flat(m).includes('<dashboard>'))).toHaveLength(1);
    // A turn without changes leaves the earlier change undoable.
    expect((await undo(d.id, change.changeId, (await getDash(d.id)).version)).status).toBe(200);
  });

  it('after an undo the next transcript says so', async () => {
    const d = await newDashboard();
    const built = await chat(d.id, 'build it');
    const change = built.find((e) => e.type === 'dashboard_changed') as Extract<
      ChatEvent,
      { type: 'dashboard_changed' }
    >;
    expect((await undo(d.id, change.changeId, 4)).status).toBe(200);
    await chat(d.id, 'what changed?');
    const body = JSON.stringify((await lastRequest()).body.messages);
    expect(body).toContain('[The user undid these changes]');
  });
});

describe('F19-T7 errors keep what was done', () => {
  it('client abort mid-turn: the change stays undoable, the answer is saved with "(stopped)"', async () => {
    const d = await newDashboard();
    await script({
      steps: [
        { tools: [{ name: 'rename_dashboard', input: { title: 'Mid turn' } }] },
        { text: Array.from({ length: 100 }, (_, k) => `w${k}`).join(' '), delayMs: 50 },
      ],
    });
    const controller = new AbortController();
    await chat(d.id, 'rename it slowly', cookies.ops, {
      signal: controller.signal,
      onEvent: (e: ChatEvent) => e.type === 'text' && controller.abort(),
    });
    await idle();
    const t = await thread(d.id);
    expect(t.messages).toHaveLength(2);
    expect(t.messages[1]!.text).toMatch(/\(stopped\)$/);
    expect(t.messages[1]!.change).toMatchObject({ undoable: true });
    expect((await getDash(d.id)).title).toBe('Mid turn');
  });

  it('refusal and busy: answer saved with a note; changes kept', async () => {
    const d = await newDashboard();
    await script({
      steps: [
        { tools: [{ name: 'rename_dashboard', input: { title: 'Before refusal' } }] },
        { refusal: true },
      ],
    });
    const refused = await chat(d.id, 'do it');
    expect(refused.at(-1)).toMatchObject({ type: 'error', code: 'refusal' });
    expect(refused.at(-2)!.type).toBe('thread_saved');
    const busy = await chat(d.id, '[fake:busy]');
    expect(busy.at(-1)).toMatchObject({ type: 'error', code: 'busy' });
    const t = await thread(d.id);
    expect(t.messages).toHaveLength(4);
    expect(t.messages[1]!.text).toMatch(/\(error: /);
    expect(t.messages[1]!.change!.summary).toBe('Renamed dashboard to "Before refusal"');
    expect(t.messages[1]!.change!.undoable).toBe(true);
    expect(t.messages[3]!.text).toMatch(/\(error: Assistant is busy/);
  });

  it('the 12-step cap and an invalid widget', async () => {
    const d = await newDashboard();
    const many = await chat(d.id, '[fake:dash-many]');
    expect(many.filter((e) => e.type === 'tool_start')).toHaveLength(12);
    expect(many.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
    const invalid = await chat(d.id, '[fake:dash-invalid]');
    expect(invalid.find((e) => e.type === 'tool_end')).toMatchObject({ ok: false });
    expect(text(invalid)).toMatch(/Sorry, I can't add that/);
    const t = await thread(d.id);
    expect(t.messages[1]!.text).toContain('stopped after 12 steps');
    expect(t.messages[1]!.chips).toHaveLength(12);
    expect(t.messages[3]!.chips[0]).toMatchObject({ tool: 'add_widget', status: 'error' });
    expect((await getDash(d.id)).version).toBe(1);
  }, 20_000);

  it('not configured → SSE error and nothing appended', async () => {
    const d = await newDashboard();
    const saved = { fake: process.env.FMS_ASSISTANT_FAKE, key: process.env.ANTHROPIC_API_KEY };
    process.env.FMS_ASSISTANT_FAKE = '0';
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await chat(d.id, 'hi')).toEqual([
        expect.objectContaining({ type: 'error', code: 'not_configured' }),
      ]);
    } finally {
      process.env.FMS_ASSISTANT_FAKE = saved.fake;
      if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    }
    expect((await thread(d.id)).messages).toHaveLength(0);
  });
});

describe('F19-T8 global chat builds a dashboard', () => {
  it('dashboard_created with url, ≥ 3 widgets, thread seeded with 2 messages', async () => {
    const events = await sse(
      '/api/chat',
      {
        messages: [
          {
            role: 'user',
            content: 'Build a dashboard of running vs stopped and top idle vehicles',
          },
        ],
      },
      cookies.ops,
    );
    const created = events.find((e) => e.type === 'dashboard_created') as Extract<
      ChatEvent,
      { type: 'dashboard_created' }
    >;
    expect(created.url).toBe(`/dashboards/${created.dashboard.id}`);
    expect(created.dashboard.widgetCount).toBeGreaterThanOrEqual(3);
    expect(text(events)).toContain(`](${created.url})`);
    expect(events.at(-1)!.type).toBe('done');
    const t = await thread(created.dashboard.id);
    expect(t.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(t.messages[0]!.text).toContain('Build a dashboard');
    expect(t.messages[1]!.chips).toEqual([
      {
        tool: 'create_dashboard',
        label: 'Created dashboard "Fleet overview" (3 widgets)',
        status: 'ok',
      },
    ]);
  });
});
