// @vitest-environment node
import {
  chatEventSchema,
  dashboardSchema,
  type ChatEvent,
  type Dashboard,
  type ThreadMessage,
} from '@shared/contract/index.ts';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requestPrefix, toAnthropicMessages } from '../assistant/anthropic-provider.ts';
import {
  chatCacheKey,
  runChat,
  toApiMessages,
  type RunOptions,
} from '../assistant/assistant-runner.ts';
import { buildTools, toolDefinitions, type ToolHost } from '../assistant/assistant-tools.ts';
import { threadToMessages } from '../assistant/dashboard-chat.ts';
import { toOpenAiMessages, toOpenAiTools } from '../assistant/openai-provider.ts';
import { emptyUsage, ProviderCutError, type ChatProvider } from '../assistant/provider.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F24 (D-141): byte-stable prefix, per-provider cache settings, fake cache hits; F23 stream items. */

process.env.FMS_ASSISTANT_FAKE = '1';
process.env.FMS_ASSISTANT_PROVIDER = 'anthropic';
delete process.env.FMS_ASSISTANT_MODEL;
delete process.env.FMS_XAI_STREAM_USAGE;
delete process.env.FMS_SSE_HEARTBEAT_MS;

type Provider = 'anthropic' | 'openai' | 'xai';
const setProvider = (p: Provider) => (process.env.FMS_ASSISTANT_PROVIDER = p);

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Raw SSE body → events (comment lines such as `: ping` are skipped, as browsers do). */
function parseSse(raw: string) {
  return raw
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => chatEventSchema.parse(JSON.parse(block.slice(6))));
}

async function post(path: string, body: unknown, cookie = cookies.ops, signal?: AbortSignal) {
  const res = await fetch(server.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    signal,
  });
  expect(res.status).toBe(200);
  return res.text();
}
const ask = async (question: string, cookie = cookies.ops) =>
  parseSse(await post('/api/chat', { messages: [{ role: 'user', content: question }] }, cookie));
const dashChat = async (id: string, message: string) =>
  parseSse(await post(`/api/dashboards/${id}/chat`, { message }));
const done = (events: ChatEvent[]) => {
  const last = events.at(-1)!;
  expect(last.type).toBe('done');
  return last as Extract<ChatEvent, { type: 'done' }>;
};
const script = (body: unknown) =>
  server.api('POST', '/api/dev/assistant/script', {
    body,
    schema: z.unknown(),
    cookie: cookies.ops,
  });
interface CacheStats {
  turns: number;
  inputTokens: number;
  cachedTokens: number;
  hitRate: number;
}
interface Stats {
  activeRuns: number;
  cache: Record<string, CacheStats>;
  streamEnds: Record<string, number>;
}
const stats = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/stats`)).json()) as Stats;
const lastRequest = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    wire: string;
    convId?: string;
    body: Record<string, unknown> & { messages: { role: string; content: unknown }[] };
  };
async function newDashboard(title = 'F24'): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: { title },
    cookie: cookies.ops,
    schema: dashboardSchema,
  });
  return res.body;
}
const idle = async () => {
  for (let k = 0; k < 100 && (await stats()).activeRuns > 0; k++)
    await new Promise((r) => setTimeout(r, 20));
};

const hostOf = (k: 'ops' | 'superadmin', dashboardId?: string) => {
  const user = server.ctx.accounts.user(`u-${k}`);
  return {
    ctx: server.ctx,
    user,
    permissions: server.ctx.accounts.permissions(user),
    entities: new Map(),
    emit: () => {},
    mode: dashboardId ? { kind: 'dashboard', dashboardId } : { kind: 'global' },
  } as unknown as ToolHost;
};

describe('F24-T1 the cached prefix is byte-identical (snapshot)', () => {
  it('Anthropic, OpenAI and xAI prefixes: same for every user and chat, and match the snapshot', () => {
    const hosts = [hostOf('ops'), hostOf('superadmin', 'dash-x'), hostOf('ops', 'dash-y')];
    const anthropic = hosts.map((h) =>
      digest({ ...requestPrefix(), tools: toolDefinitions(buildTools(h)) }),
    );
    const openai = hosts.map((h) =>
      digest({ tools: toOpenAiTools(buildTools(h), true), system: toOpenAiMessages([])[0] }),
    );
    const xai = hosts.map((h) =>
      digest({ tools: toOpenAiTools(buildTools(h), false), system: toOpenAiMessages([])[0] }),
    );
    for (const list of [anthropic, openai, xai]) expect(new Set(list).size).toBe(1);
    // A deliberate prompt / tool / settings change updates this snapshot (and the cache).
    expect({ anthropic: anthropic[0], openai: openai[0], xai: xai[0] }).toMatchSnapshot();
  });
});

describe('F24-T2 earlier turns never change; per-request context only in the latest user turn', () => {
  const ctxA = { name: 'Ops User', role: 'Operator', fleets: ['North'], today: '2026-10-14' };
  const ctxB = { name: 'Super Admin', role: 'Admin', fleets: [], today: '2026-10-15' };

  it('global chat: turn N+1 starts with turn N minus its latest user turn', () => {
    const t2 = toApiMessages(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
      ctxA,
    );
    const t3 = toApiMessages(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'q3' },
      ],
      ctxB,
    );
    expect(JSON.stringify(t3.slice(0, 2))).toBe(JSON.stringify(t2.slice(0, 2)));
    expect(t3.slice(0, 4).every((m) => typeof m.content === 'string')).toBe(true);
    expect(JSON.stringify(t3.at(-1))).toContain('<context>');
    expect(JSON.stringify(t3.slice(0, -1))).not.toContain('<context>');
  });

  it('dashboard chat: the same, with <context> and <dashboard> in the latest turn', () => {
    const m = (seq: number, role: 'user' | 'assistant', text: string): ThreadMessage => ({
      id: `m${seq}`,
      seq,
      role,
      text,
      chips: [],
      change: null,
      previews: [],
      createdAt: seq,
      outcome: 'done',
    });
    const thread = [m(1, 'user', 'q1'), m(2, 'assistant', 'a1'), m(3, 'user', 'q2')];
    const t2 = threadToMessages(thread, '<context>A</context>', '<dashboard>v1</dashboard>');
    const t3 = threadToMessages(
      [...thread, m(4, 'assistant', 'a2'), m(5, 'user', 'q3')],
      '<context>B</context>',
      '<dashboard>v2</dashboard>',
    );
    expect(JSON.stringify(t3.slice(0, 2))).toBe(JSON.stringify(t2.slice(0, 2)));
    expect(JSON.stringify(t3.slice(0, -1))).not.toMatch(/<context>|<dashboard>/);
    expect(t3.at(-1)!.content).toEqual([
      { type: 'text', text: '<context>B</context>' },
      { type: 'text', text: '<dashboard>v2</dashboard>' },
      { type: 'text', text: 'q3' },
    ]);
  });
});

describe('F24-T3 Anthropic breakpoints (both chats)', () => {
  it('system block, history end and top-level automatic caching; at most 4 markers', async () => {
    setProvider('anthropic');
    const d = await newDashboard();
    await dashChat(d.id, 'hello');
    await dashChat(d.id, 'hello again');
    const { body } = await lastRequest();
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    const marker = { cache_control: { type: 'ephemeral' } };
    expect(body.system).toEqual([expect.objectContaining(marker)]);
    const msgs = body.messages;
    const latest = msgs.findLastIndex((m) => JSON.stringify(m).includes('<context>'));
    expect(latest).toBe(2);
    expect(JSON.stringify(msgs[latest - 1])).toContain('"cache_control"');
    expect(JSON.stringify(msgs.slice(0, latest - 1))).not.toContain('"cache_control"');
    expect(JSON.stringify(body).match(/"cache_control"/g)!.length).toBeLessThanOrEqual(4);

    // Global chat: the same marker on the message before the latest user turn.
    await post('/api/chat', {
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
    });
    const global = (await lastRequest()).body.messages;
    expect(global[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'a1', cache_control: { type: 'ephemeral' } }],
    });
  });
});

describe('F24-T4 OpenAI prompt_cache_key and xAI conversation id', () => {
  afterAll(() => {
    setProvider('anthropic');
    delete process.env.FMS_XAI_STREAM_USAGE;
  });

  it('OpenAI: one key per user + chat, hashed', async () => {
    setProvider('openai');
    await ask('hello');
    const ops = (await lastRequest()).body;
    expect(ops.prompt_cache_key).toBe(chatCacheKey('u-ops', 'global'));
    expect(ops.prompt_cache_key).toMatch(/^fms-[0-9a-f]{16}$/);
    expect(ops.stream_options).toEqual({ include_usage: true });
    await ask('hello again');
    expect((await lastRequest()).body.prompt_cache_key).toBe(ops.prompt_cache_key);
    await ask('hello', cookies.superadmin);
    expect((await lastRequest()).body.prompt_cache_key).not.toBe(ops.prompt_cache_key);
    const d = await newDashboard();
    await dashChat(d.id, 'hello');
    const dash = (await lastRequest()).body.prompt_cache_key;
    expect(dash).toBe(chatCacheKey('u-ops', `d:${d.id}`));
    expect(dash).not.toBe(ops.prompt_cache_key);
  });

  it('xAI: x-grok-conv-id header, usage requested, no prompt_cache_key; FMS_XAI_STREAM_USAGE=0', async () => {
    setProvider('xai');
    const events = await ask('hello');
    const last = await lastRequest();
    expect(last.convId).toBe(chatCacheKey('u-ops', 'global'));
    expect(last.body).not.toHaveProperty('prompt_cache_key');
    expect(last.body.stream_options).toEqual({ include_usage: true });
    expect(done(events).usage!.inputTokens).toBeGreaterThan(0);

    process.env.FMS_XAI_STREAM_USAGE = '0';
    const quiet = await ask('hello');
    expect((await lastRequest()).body).not.toHaveProperty('stream_options');
    expect(done(quiet).usage!.inputTokens).toBe(0);
  });
});

describe('F24-T5 fake providers report cache hits from turn 2', () => {
  afterAll(() => setProvider('anthropic'));

  it.each(['anthropic', 'openai', 'xai'] as const)('%s', async (provider) => {
    setProvider(provider);
    const d = await newDashboard(`F24 ${provider}`);
    const turns: number[] = [];
    // Questions unique to this test: identical histories elsewhere would be read too.
    for (const q of [`hello ${provider}`, `hello again ${provider}`, `once more ${provider}`])
      turns.push(done(await dashChat(d.id, q)).usage!.cacheReadInputTokens);
    expect(turns[1]).toBeGreaterThan(0);
    // From turn 3 the earlier turns are read too, not just the tools + system prefix.
    expect(turns[2]).toBeGreaterThan(turns[1]!);
    const s = (await stats()).cache[provider]!;
    expect(s.turns).toBeGreaterThanOrEqual(3);
    expect(s.cachedTokens).toBeGreaterThan(0);
    expect(s.hitRate).toBeGreaterThan(0);
    expect(s.hitRate).toBeLessThanOrEqual(1);
  });
});

describe('F24-T6 SSE heartbeat (F23)', () => {
  it('a `: ping` comment every FMS_SSE_HEARTBEAT_MS; events still parse', async () => {
    setProvider('anthropic');
    process.env.FMS_SSE_HEARTBEAT_MS = '25';
    try {
      await script({ steps: [{ text: 'one two three four five six seven eight', delayMs: 40 }] });
      const raw = await post('/api/chat', { messages: [{ role: 'user', content: 'slowly' }] });
      expect(raw).toMatch(/(^|\n): ping\n\n/);
      const events = parseSse(raw);
      expect(done(events).stopReason).toBe('end_turn');
      const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
      expect(text).toContain('seven eight');
    } finally {
      delete process.env.FMS_SSE_HEARTBEAT_MS;
    }
  });
});

describe('F24-T7 stream end reasons (F23)', () => {
  const ends = async () => (await stats()).streamEnds;

  it('done, error, client-abort and provider-cut are counted', async () => {
    setProvider('anthropic');
    const before = await ends();
    await ask('hello');
    await script({ name: 'refusal' });
    expect((await ask('anything')).at(-1)).toMatchObject({ type: 'error', code: 'refusal' });

    await script({ name: 'slow' });
    const controller = new AbortController();
    const res = await fetch(`${server.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies.ops },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'slow' }] }),
      signal: controller.signal,
    });
    await res.body!.getReader().read();
    controller.abort();
    await idle();

    for (const p of ['anthropic', 'openai'] as const) {
      setProvider(p);
      await script({ name: 'cut' });
      expect((await ask('cut me off')).at(-1)).toMatchObject({ type: 'error', code: 'busy' });
    }
    setProvider('anthropic');
    await idle();
    const after = await ends();
    expect(after.done! - before.done!).toBeGreaterThanOrEqual(1);
    expect(after.error! - before.error!).toBeGreaterThanOrEqual(1);
    expect(after['client-abort']! - before['client-abort']!).toBe(1);
    expect(after['provider-cut']! - before['provider-cut']!).toBe(2);
  });

  it('runChat end reasons: timeout and provider-cut (unit)', async () => {
    const provider = (err: unknown, kind: 'busy' | 'failed' = 'busy'): ChatProvider => ({
      name: 'openai',
      model: 'm',
      run: () => Promise.reject(err),
      classify: () => ({ kind }),
    });
    const base = (p: ChatProvider, abort?: 'timeout'): RunOptions => ({
      provider: p,
      host: {} as RunOptions['host'],
      context: { name: 'n', role: 'r', fleets: [], today: '2026-10-15' },
      turns: [{ role: 'user', content: 'q' }],
      emit: () => {},
      signal: new AbortController().signal,
      abortReason: () => abort,
      log: () => {},
    });
    expect((await runChat(base(provider(new Error('x')), 'timeout'))).endReason).toBe('timeout');
    expect((await runChat(base(provider(new ProviderCutError())))).endReason).toBe('provider-cut');
    expect((await runChat(base(provider(new Error('x'), 'failed')))).endReason).toBe('error');
    const ok: ChatProvider = {
      name: 'anthropic',
      model: 'm',
      run: () => Promise.resolve({ stopReason: 'end_turn', iterations: 1, usage: emptyUsage() }),
      classify: () => ({ kind: 'failed' }),
    };
    expect((await runChat(base(ok))).endReason).toBe('done');
  });
});

describe('F24 Anthropic marker placement (unit)', () => {
  it('only the message before the latest user turn is marked; a single turn has no marker', () => {
    expect(JSON.stringify(toAnthropicMessages([{ role: 'user', content: 'q' }]))).not.toContain(
      'cache_control',
    );
    const msgs = toAnthropicMessages([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
    ]);
    expect(msgs[0]).toEqual({ role: 'user', content: 'q1' });
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'a1', cache_control: { type: 'ephemeral' } }],
    });
    expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'q2' }] });
  });
});
