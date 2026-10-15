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

/**
 * D-155: a dashboard-chat turn's outcome is stored on its reply (Retry survives a reload), Stop
 * is stored as `stopped`, and `retryOf` re-runs the caller's latest failed turn in place.
 */

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<'ops' | 'superadmin', string>;

beforeAll(async () => {
  server = await startServer();
  cookies.ops = await server.login(SEED_USERS.ops);
  cookies.superadmin = await server.login(SEED_USERS.superadmin);
});
afterAll(() => server.close());

async function chat(
  id: string,
  body: { message: string; retryOf?: string },
  cookie = cookies.ops,
  opts: { signal?: AbortSignal; onEvent?: (e: ChatEvent) => void } = {},
) {
  const res = await fetch(`${server.base}/api/dashboards/${id}/chat`, {
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

async function newDashboard(cookie = cookies.ops): Promise<Dashboard> {
  const res = await server.api('POST', '/api/dashboards', {
    body: { title: 'Outcome test' },
    cookie,
    schema: dashboardSchema,
  });
  return res.body;
}
const thread = async (id: string, cookie = cookies.ops) =>
  (
    await server.api('GET', `/api/dashboards/${id}/thread`, {
      cookie,
      schema: dashboardThreadSchema,
    })
  ).body as DashboardThread;
const script = (body: unknown) =>
  server.api('POST', '/api/dev/assistant/script', { body, schema: z.unknown() });
const post = (path: string, body: unknown, cookie = cookies.ops) =>
  server.api('POST', path, { body, cookie, schema: z.unknown() });
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

describe('D-155 stored outcome', () => {
  it('error (model error, refusal) keeps the user message and the code', async () => {
    const d = await newDashboard();
    const events = await chat(d.id, { message: '[fake:failed]' });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'failed' });
    await chat(d.id, { message: '[fake:refusal]' });
    const t = await thread(d.id);
    expect(t.messages.map((m) => [m.role, m.outcome, m.errorCode])).toEqual([
      ['user', 'done', undefined],
      ['assistant', 'error', 'failed'],
      ['user', 'done', undefined],
      ['assistant', 'error', 'refusal'],
    ]);
    expect(t.messages[0]!.text).toBe('[fake:failed]');
  });

  it('interrupted: client abort and provider cut; partial text and the change set kept', async () => {
    const d = await newDashboard();
    await script({
      steps: [
        { tools: [{ name: 'rename_dashboard', input: { title: 'Half done' } }] },
        { text: Array.from({ length: 100 }, (_, k) => `w${k}`).join(' '), delayMs: 50 },
      ],
    });
    const controller = new AbortController();
    await chat(
      d.id,
      { message: 'rename it slowly' },
      cookies.ops,
      { signal: controller.signal, onEvent: (e) => e.type === 'text' && controller.abort() },
    );
    await idle();
    await script({ name: 'cut' });
    const cut = await chat(d.id, { message: 'something' });
    expect(cut.at(-1)).toMatchObject({ type: 'error', code: 'busy' });
    const t = await thread(d.id);
    expect(t.messages[1]).toMatchObject({ outcome: 'interrupted', change: { undoable: true } });
    expect(t.messages[1]!.text).toMatch(/^w0[\s\S]*\(interrupted\)$/);
    expect(t.messages[3]).toMatchObject({ outcome: 'interrupted', errorCode: 'busy' });
    expect(t.messages[3]!.text).toContain('Partial answer that never');
  });

  it('stopped: POST …/chat/stop ends the turn, thread_saved then the stream ends', async () => {
    const d = await newDashboard();
    let stopped: Promise<{ status: number }> | undefined;
    const events = await chat(
      d.id,
      { message: '[fake:slow]' },
      cookies.ops,
      {
        onEvent: (e) => {
          if (e.type === 'text' && !stopped)
            stopped = post(`/api/dashboards/${d.id}/chat/stop`, undefined);
        },
      },
    );
    expect((await stopped!).status).toBe(204);
    expect(events.at(-1)!.type).toBe('thread_saved');
    expect(events.some((e) => e.type === 'done' || e.type === 'error')).toBe(false);
    const t = await thread(d.id);
    expect(t.messages[1]).toMatchObject({ outcome: 'stopped' });
    expect(t.messages[1]!.text).toMatch(/\(stopped\)$/);
    // Nothing running: 204, nothing changes.
    expect((await post(`/api/dashboards/${d.id}/chat/stop`, undefined)).status).toBe(204);
  });

  it('a failure before the model runs still stores the user message (error reply)', async () => {
    const d = await newDashboard();
    const store = server.ctx.dashboards;
    const original = store.thread.bind(store);
    let calls = 0;
    store.thread = (userId, id) => {
      if (++calls === 1) throw new Error('boom');
      return original(userId, id);
    };
    try {
      const events = await chat(d.id, { message: 'hello there' });
      expect(events.map((e) => e.type)).toEqual(['thread_saved', 'error']);
    } finally {
      store.thread = original;
    }
    const t = await thread(d.id);
    expect(t.messages.map((m) => [m.role, m.outcome, m.errorCode])).toEqual([
      ['user', 'done', undefined],
      ['assistant', 'error', 'failed'],
    ]);
  });
});

describe('D-155 retryOf', () => {
  it('replaces the failed reply in place; no second user message; changes carried over', async () => {
    const d = await newDashboard();
    await script({
      steps: [{ tools: [{ name: 'rename_dashboard', input: { title: 'Kept' } }] }, { error: 500 }],
    });
    await chat(d.id, { message: 'hello there' });
    const before = await thread(d.id);
    const failed = before.messages[1]!;
    expect(failed).toMatchObject({ outcome: 'error', change: { undoable: true } });

    const events = await chat(d.id, { message: 'hello there', retryOf: failed.id });
    expect(events.at(-1)!.type).toBe('done');
    const saved = events.find((e) => e.type === 'thread_saved');
    expect(saved).toMatchObject({ messages: [{ id: before.messages[0]!.id }, { id: failed.id }] });
    const t = await thread(d.id);
    expect(t.messages).toHaveLength(2);
    expect(t.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(t.messages[1]).toMatchObject({
      id: failed.id,
      seq: failed.seq,
      outcome: 'done',
      change: { id: failed.change!.id, undoable: true },
    });
    expect(t.messages[1]!.errorCode).toBeUndefined();
    expect(t.messages[1]!.chips.map((c) => c.tool)).toContain('rename_dashboard');
    // The model saw the user message last, without the failed reply.
    const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
      body: { messages: { role: string }[] };
    };
    expect(last.body.messages.at(-1)!.role).toBe('user');
    expect(last.body.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    // Undo still works for the change the failed turn made.
    const dash = (await server.api('GET', `/api/dashboards/${d.id}`, {
      cookie: cookies.ops,
      schema: dashboardSchema,
    })).body;
    expect(dash.title).toBe('Kept');
    const undo = await post(`/api/dashboards/${d.id}/changes/${failed.change!.id}/undo`, {
      version: dash.version,
    });
    expect(undo.status).toBe(200);
  });

  it('409 not_retryable: already done, not the latest turn, or another user’s thread', async () => {
    const d = await newDashboard(cookies.superadmin);
    await post(
      `/api/dashboards/${d.id}/shares`,
      { userIds: ['u-ops'], access: 'edit' },
      cookies.superadmin,
    );
    await chat(d.id, { message: '[fake:failed]' }, cookies.superadmin);
    const failedId = (await thread(d.id, cookies.superadmin)).messages[1]!.id;

    // Another user's thread: the editor cannot retry the owner's turn.
    const other = await post(
      `/api/dashboards/${d.id}/chat`,
      { message: 'x', retryOf: failedId },
      cookies.ops,
    );
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ error: { code: 'not_retryable' } });
    expect((await thread(d.id, cookies.ops)).messages).toHaveLength(0);

    // Not the latest turn any more.
    await chat(d.id, { message: 'hello there' }, cookies.superadmin);
    const t = await thread(d.id, cookies.superadmin);
    const stale = await post(
      `/api/dashboards/${d.id}/chat`,
      { message: 'x', retryOf: failedId },
      cookies.superadmin,
    );
    expect(stale.status).toBe(409);
    // Latest, but it ended done.
    const done = await post(
      `/api/dashboards/${d.id}/chat`,
      { message: 'x', retryOf: t.messages[3]!.id },
      cookies.superadmin,
    );
    expect(done.status).toBe(409);
    expect(done.body).toMatchObject({ error: { code: 'not_retryable' } });
    // The lock was released: a normal turn still runs.
    expect((await chat(d.id, { message: 'hello there' }, cookies.superadmin)).at(-1)!.type).toBe(
      'done',
    );
    expect((await thread(d.id, cookies.superadmin)).messages).toHaveLength(6);
  });
});
