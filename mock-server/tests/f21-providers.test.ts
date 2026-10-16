// @vitest-environment node
import {
  chatEventSchema,
  dashboardSchema,
  dashboardThreadSchema,
  type ChatEvent,
  type Dashboard,
  type DashboardThread,
  type ReportDescriptor,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assistantEnv } from '../assistant/assistant-config.ts';
import { buildTools, TOOL_NAMES, type ToolHost } from '../assistant/assistant-tools.ts';
import { isStrictCompatible, toOpenAiTools } from '../assistant/openai-provider.ts';
import { SYSTEM_PROMPT } from '../assistant/system-prompt.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/**
 * F21 (D-134): provider resolution, the zod → OpenAI tool conversion, and the F17/F19 contract
 * scenarios through the OpenAI-compatible adapter against the fake chat-completions endpoint.
 */

process.env.FMS_ASSISTANT_FAKE = '1';
process.env.FMS_ASSISTANT_PROVIDER = 'openai';
delete process.env.FMS_ASSISTANT_MODEL;

const setProvider = (p: 'openai' | 'xai' | 'anthropic') => (process.env.FMS_ASSISTANT_PROVIDER = p);

describe('F21-T1 assistantEnv: provider and model resolution', () => {
  const dev = { NODE_ENV: 'development' };
  const prod = { NODE_ENV: 'production' };
  const cases: [string, NodeJS.ProcessEnv, object][] = [
    ['no key in dev → fake (anthropic wire)', dev, { mode: 'fake', provider: 'anthropic' }],
    ['no key in production → not-configured', prod, { mode: 'not-configured' }],
    [
      'FAKE=0 and no key → not-configured',
      { ...dev, FMS_ASSISTANT_FAKE: '0' },
      { mode: 'not-configured' },
    ],
    [
      'empty values count as unset',
      { ...dev, FMS_ASSISTANT_FAKE: '', FMS_ASSISTANT_PROVIDER: ' ', XAI_API_KEY: '' },
      { mode: 'fake', provider: 'anthropic' },
    ],
    [
      'FAKE=1 beats a real key',
      { ...prod, FMS_ASSISTANT_FAKE: '1', ANTHROPIC_API_KEY: 'k' },
      { mode: 'fake', provider: 'anthropic', model: 'claude-opus-5-5' },
    ],
    [
      'FAKE=1 + provider xai → fake over the OpenAI wire',
      { ...dev, FMS_ASSISTANT_FAKE: '1', FMS_ASSISTANT_PROVIDER: 'xai' },
      { mode: 'fake', provider: 'xai', model: 'fake-model' },
    ],
    [
      'provider=fake',
      { ...prod, FMS_ASSISTANT_PROVIDER: 'fake' },
      { mode: 'fake', provider: 'anthropic' },
    ],
    [
      'auto-pick anthropic first',
      {
        ...dev,
        ANTHROPIC_API_KEY: 'a',
        OPENAI_API_KEY: 'o',
        XAI_API_KEY: 'x',
        FMS_ASSISTANT_MODEL: 'm',
      },
      { mode: 'real', provider: 'anthropic', apiKey: 'a', model: 'm' },
    ],
    [
      'auto-pick openai before xai',
      { ...dev, OPENAI_API_KEY: 'o', XAI_API_KEY: 'x', FMS_ASSISTANT_MODEL: 'gpt-5' },
      { mode: 'real', provider: 'openai', apiKey: 'o', model: 'gpt-5' },
    ],
    [
      'auto-pick xai',
      { ...prod, XAI_API_KEY: 'x', FMS_ASSISTANT_MODEL: 'grok-4' },
      { mode: 'real', provider: 'xai', apiKey: 'x', model: 'grok-4' },
    ],
    [
      'anthropic defaults its model',
      { ...prod, ANTHROPIC_API_KEY: 'a' },
      { mode: 'real', provider: 'anthropic', model: 'claude-opus-5-5' },
    ],
    [
      'explicit provider wins over auto-pick',
      {
        ...prod,
        FMS_ASSISTANT_PROVIDER: 'xai',
        ANTHROPIC_API_KEY: 'a',
        XAI_API_KEY: 'x',
        FMS_ASSISTANT_MODEL: 'grok-4',
      },
      { mode: 'real', provider: 'xai', apiKey: 'x' },
    ],
    [
      'explicit provider without its key → not-configured',
      { ...dev, FMS_ASSISTANT_PROVIDER: 'xai', ANTHROPIC_API_KEY: 'a' },
      { mode: 'not-configured', reason: expect.stringContaining('XAI_API_KEY') },
    ],
    [
      'xai without a model → not-configured',
      { ...dev, XAI_API_KEY: 'x' },
      {
        mode: 'not-configured',
        reason: expect.stringContaining('FMS_ASSISTANT_MODEL is required for the xai provider'),
      },
    ],
    [
      'openai without a model → not-configured',
      { ...dev, FMS_ASSISTANT_PROVIDER: 'openai', OPENAI_API_KEY: 'o' },
      { mode: 'not-configured', reason: expect.stringContaining('FMS_ASSISTANT_MODEL') },
    ],
    [
      'unknown provider → not-configured',
      { ...dev, FMS_ASSISTANT_PROVIDER: 'gemini' },
      { mode: 'not-configured', reason: expect.stringContaining('gemini') },
    ],
    [
      'base URL override is kept',
      {
        ...prod,
        XAI_API_KEY: 'x',
        FMS_ASSISTANT_MODEL: 'grok-4',
        FMS_ASSISTANT_BASE_URL: 'http://proxy/v1',
      },
      { mode: 'real', baseURL: 'http://proxy/v1' },
    ],
  ];
  it.each(cases)('%s', (_name, env, expected) => {
    expect(assistantEnv(env)).toMatchObject(expected);
  });
});

describe('F21-T2 zod tools → OpenAI tools', () => {
  const tools = () => buildTools({ entities: new Map(), emit: () => {} } as unknown as ToolHost);

  it('all 37 tools (D-135 preview_widget, F29 actions) convert (snapshot); strict only where the schema qualifies', () => {
    const openai = toOpenAiTools(tools(), true);
    expect(openai.map((t) => t.function.name)).toEqual(TOOL_NAMES);
    expect(openai).toHaveLength(37);
    for (const t of openai) {
      expect(t.type).toBe('function');
      expect(t.function.parameters.type).toBe('object');
      expect(t.function.parameters).not.toHaveProperty('$schema');
      if (t.function.strict) expect(isStrictCompatible(t.function.parameters)).toBe(true);
    }
    expect(openai).toMatchSnapshot();
  });

  it('the widget tools keep the strict-safe widget schema; xAI gets no strict flag', () => {
    const openai = toOpenAiTools(tools(), true);
    const add = openai.find((t) => t.function.name === 'add_widget')!;
    const json = JSON.stringify(add.function.parameters);
    expect(json).not.toMatch(/"(maxLength|maxItems|pattern|oneOf)"/);
    expect(json).toContain('"anyOf"');
    expect(toOpenAiTools(tools(), false).some((t) => 'strict' in t.function)).toBe(false);
  });
});

// ---- F21-T3 / T4: the contract scenarios through the OpenAI-compatible path ----

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());

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

const ask = (question: string, cookie = cookies.ops, opts = {}) =>
  sse('/api/chat', { message: question }, cookie, opts);
const dashChat = (id: string, message: string) =>
  sse(`/api/dashboards/${id}/chat`, { message }, cookies.ops);
const text = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
/** Event types with runs of text deltas collapsed (chunking may differ). */
/** Event types (runs of text collapsed); F28 `thread_saved` events are left out. */
const shape = (events: ChatEvent[]) =>
  events
    .map((e) => e.type)
    .filter((t) => t !== 'thread_saved')
    .filter((t, k, a) => t !== 'text' || a[k - 1] !== 'text');
const script = (body: unknown) =>
  server.api('POST', '/api/dev/assistant/script', {
    body,
    schema: z.unknown(),
    cookie: cookies.ops,
  });
const lastRequest = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    wire: string;
    body: Record<string, unknown> & {
      messages: { role: string; content: string | null; tool_call_id?: string }[];
    };
  };
const stats = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/stats`)).json()) as {
    activeRuns: number;
    fakeAborted: number;
    provider: string;
  };
const userOf = (k: 'ops') => server.ctx.accounts.user(`u-${k}`);
const vehicleFor = (inside: boolean) => {
  const { sim, tree } = server.ctx;
  const fleets = userOf('ops').fleetIds;
  const i = [...Array(sim.count).keys()].find(
    (n) => tree.inScope(sim.fleetId(n), fleets) === inside,
  )!;
  return { regno: sim.regno(i), vehicleId: sim.vehicleId(i), fleetId: sim.fleetId(i) };
};
async function newDashboard(title = 'F21'): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: { title },
    cookie: cookies.ops,
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

/** Runs `fn` on the Anthropic path, then on the OpenAI path (provider is read per request). */
async function both<T>(fn: () => Promise<T>): Promise<{ anthropic: T; openai: T }> {
  setProvider('anthropic');
  try {
    const anthropic = await fn();
    setProvider('openai');
    return { anthropic, openai: await fn() };
  } finally {
    setProvider('openai');
  }
}

describe('F21-T3 F17/F19 scenarios through the OpenAI-compatible adapter', () => {
  it('the request is a chat-completions call: system prompt, function tools, stream', async () => {
    expect((await stats()).provider).toBe('openai');
    const { regno } = vehicleFor(true);
    await ask(`Where is ${regno}?`);
    const last = await lastRequest();
    expect(last.wire).toBe('openai');
    expect(last.body).toMatchObject({ model: 'fake-model', stream: true, tool_choice: 'auto' });
    expect(last.body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(last.body.messages[1]!.content).toContain('Ops User');
    expect(last.body.messages[1]!.content).toContain(`Where is ${regno}?`);
    // The second request carries the assistant tool call and the tool result.
    expect(last.body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const tools = last.body.tools as { type: string; function: { name: string } }[];
    expect(tools.map((t) => t.function.name)).toEqual(TOOL_NAMES);
  });

  it('vehicle question: same events as the Anthropic path', async () => {
    const { regno, vehicleId } = vehicleFor(true);
    const runs = await both(() => ask(`Where is ${regno}?`));
    expect(shape(runs.openai)).toEqual(shape(runs.anthropic));
    expect(shape(runs.openai)).toEqual(['tool_start', 'tool_end', 'text', 'entities', 'done']);
    expect(text(runs.openai)).toContain(regno);
    expect(runs.openai.find((e) => e.type === 'entities')).toMatchObject({
      items: expect.arrayContaining([{ kind: 'vehicle', id: vehicleId, label: regno }]),
    });
    const done = runs.openai.at(-1) as Extract<ChatEvent, { type: 'done' }>;
    expect(done.stopReason).toBe('end_turn');
    expect(done.usage!.cacheReadInputTokens).toBeGreaterThan(0);
  });

  it('CSV report: report event and download', async () => {
    const runs = await both(() => ask('Export no-GPS vehicles as CSV'));
    expect(shape(runs.openai)).toEqual(shape(runs.anthropic));
    const report = (runs.openai.find((e) => e.type === 'report') as { report: ReportDescriptor })
      .report;
    expect(report).toMatchObject({ kind: 'no-gps', format: 'csv' });
    const res = await fetch(server.base + report.url, { headers: { cookie: cookies.ops } });
    expect(res.status).toBe(200);
    expect((await res.text()).split('\r\n')[0]).toMatch(/^Regno,Fleet,Status,Last GPS/);
  });

  it('global chat creates a dashboard with 3 widgets', async () => {
    const q = 'Build a dashboard of running vs stopped and top idle vehicles';
    const runs = await both(() => ask(q));
    expect(shape(runs.openai)).toEqual(shape(runs.anthropic));
    const created = runs.openai.find((e) => e.type === 'dashboard_created') as Extract<
      ChatEvent,
      { type: 'dashboard_created' }
    >;
    expect(created.dashboard.widgetCount).toBe(3);
    expect(text(runs.openai)).toContain(`](${created.url})`);
    expect((await thread(created.dashboard.id)).messages).toHaveLength(2);
  });

  it('dashboard chat: build 3 widgets, change one, remove one, undo', async () => {
    const runs = await both(async () => {
      const d = await newDashboard();
      const built = await dashChat(d.id, 'Build this dashboard: running vs stopped and top idle');
      const changed = await dashChat(d.id, 'Change the ranking to 30 days');
      const removed = await dashChat(d.id, 'Remove the running vs stopped widget');
      return { d, built, changed, removed };
    });
    for (const k of ['built', 'changed', 'removed'] as const)
      expect(shape(runs.openai[k])).toEqual(shape(runs.anthropic[k]));
    const { d, built, changed, removed } = runs.openai;
    const changes = built.filter(
      (e): e is Extract<ChatEvent, { type: 'dashboard_changed' }> => e.type === 'dashboard_changed',
    );
    expect(changes.map((c) => c.version)).toEqual([2, 3, 4]);
    expect(built.slice(-2).map((e) => e.type)).toEqual(['thread_saved', 'done']);
    const update = changed.find((e) => e.type === 'dashboard_changed') as Extract<
      ChatEvent,
      { type: 'dashboard_changed' }
    >;
    const ranking = update.dashboard.widgets.find((w) => w.type === 'ranking');
    expect(ranking).toMatchObject({ range: '30d' });
    const removal = removed.find((e) => e.type === 'dashboard_changed') as Extract<
      ChatEvent,
      { type: 'dashboard_changed' }
    >;
    expect(removal.dashboard.widgets).toHaveLength(2);
    expect(text(removed)).toMatch(/Removed 1 widget/);
    const undo = await server.api(
      'POST',
      `/api/dashboards/${d.id}/changes/${removal.changeId}/undo`,
      { body: { version: removal.version }, cookie: cookies.ops, schema: dashboardSchema },
    );
    expect(undo.status).toBe(200);
    expect((undo.body as Dashboard).widgets).toHaveLength(3);
    const t = await thread(d.id);
    expect(t.messages).toHaveLength(6);
    expect(t.messages[5]!.change).toMatchObject({ undoable: false });
  });

  it('errors map to the same codes: refusal, busy, failed', async () => {
    await script({ name: 'refusal' });
    expect((await ask('anything')).at(-1)).toMatchObject({ type: 'error', code: 'refusal' });
    await script({ name: 'busy' });
    expect((await ask('anything')).at(-1)).toMatchObject({ type: 'error', code: 'busy' });
    await script({ name: 'failed' });
    expect((await ask('anything')).at(-1)).toMatchObject({ type: 'error', code: 'failed' });
  });

  it('step caps: 8 in the global chat, 12 in a dashboard chat', async () => {
    await script({ name: 'loop' });
    const loop = await ask('loop forever');
    expect(loop.filter((e) => e.type === 'tool_start')).toHaveLength(8);
    expect(loop.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
    expect(text(loop)).toContain('stopped after 8 steps');
    const d = await newDashboard();
    const many = await dashChat(d.id, '[fake:dash-many]');
    expect(many.filter((e) => e.type === 'tool_start')).toHaveLength(12);
    expect(many.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
  }, 20_000);

  it('an invalid widget reaches the model as a tool error', async () => {
    const d = await newDashboard();
    const invalid = await dashChat(d.id, '[fake:dash-invalid]');
    expect(invalid.find((e) => e.type === 'tool_end')).toMatchObject({ ok: false });
    expect(text(invalid)).toMatch(/Sorry, I can't add that/);
  });

  it('a client abort stops the upstream stream', async () => {
    await script({ name: 'slow' });
    const before = (await stats()).fakeAborted;
    const controller = new AbortController();
    const events = await ask('slow', cookies.ops, {
      signal: controller.signal,
      onEvent: (e: ChatEvent) => e.type === 'text' && controller.abort(),
    });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    for (let k = 0; k < 50; k++) {
      const s = await stats();
      if (s.activeRuns === 0 && s.fakeAborted > before) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const s = await stats();
    expect(s.activeRuns).toBe(0);
    expect(s.fakeAborted).toBeGreaterThan(before);
  });

  it('xai uses the same adapter (no strict flags)', async () => {
    setProvider('xai');
    try {
      const { regno } = vehicleFor(true);
      expect(shape(await ask(`Where is ${regno}?`)).at(-1)).toBe('done');
      const last = await lastRequest();
      expect(last.wire).toBe('openai');
      expect(JSON.stringify(last.body.tools)).not.toContain('"strict"');
      // F24 (D-141): usage is requested from xAI too (FMS_XAI_STREAM_USAGE=0 turns it off).
      expect(last.body).toHaveProperty('stream_options', { include_usage: true });
    } finally {
      setProvider('openai');
    }
  });

  it('missing model for a real provider → not_configured', async () => {
    const saved = { ...process.env };
    process.env.FMS_ASSISTANT_FAKE = '0';
    process.env.XAI_API_KEY = 'x';
    setProvider('xai');
    try {
      expect(await ask('hi')).toEqual([
        expect.objectContaining({ type: 'error', code: 'not_configured' }),
      ]);
    } finally {
      process.env.FMS_ASSISTANT_FAKE = saved.FMS_ASSISTANT_FAKE;
      if (saved.XAI_API_KEY === undefined) delete process.env.XAI_API_KEY;
      setProvider('openai');
    }
  });
});

describe('F21-T4 scope through the OpenAI path', () => {
  it('an out-of-scope regno is "not found" and nothing about it reaches the model', async () => {
    const { regno, vehicleId } = vehicleFor(false);
    const events = await ask(`Where is ${regno}?`);
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
      ok: false,
      summary: 'Not found',
    });
    expect(events.some((e) => e.type === 'entities')).toBe(false);
    const tool = (await lastRequest()).body.messages.find((m) => m.role === 'tool')!;
    expect(tool.content).toMatch(/^Error: .*not found/);
    expect(tool.content).not.toContain(vehicleId);
    expect(text(events)).toMatch(/not found/);
  });

  it('search results sent to the model stay inside the scope', async () => {
    const north = new Set(
      [...server.ctx.tree.byId.values()]
        .filter((f) => server.ctx.tree.inScope(f.id, userOf('ops').fleetIds))
        .map((f) => f.name),
    );
    await script({
      steps: [
        {
          tools: [
            { name: 'find_vehicles', input: { limit: 50 } },
            { name: 'fleet_summary', input: { fleet: 'South' } },
          ],
        },
        { text: 'ok' },
      ],
    });
    await ask('scope check');
    const results = (await lastRequest()).body.messages.filter((m) => m.role === 'tool');
    expect(results).toHaveLength(2);
    const items = (JSON.parse(results[0]!.content!) as { items: { fleet: string }[] }).items;
    expect(items).toHaveLength(50);
    expect(items.every((v) => north.has(v.fleet))).toBe(true);
    expect(results[1]!.content).toMatch(/^Error: .*not found/i);
  });
});
