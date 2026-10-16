// @vitest-environment node
import {
  CHAT_THREADS_PER_USER,
  chatEventSchema,
  chatThreadDetailSchema,
  chatThreadListSchema,
  chatThreadSummarySchema,
  type ChatEvent,
  type ChatThreadDetail,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SEED_USERS, startServer } from '../testing/harness.ts';

process.env.FMS_ASSISTANT_FAKE = '1';

/** F28-T1…T3: saved Ask FMS conversations (store + API, fake model). */

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<'ops' | 'superadmin', string>;

beforeAll(async () => {
  server = await startServer();
  cookies.ops = await server.login(SEED_USERS.ops);
  cookies.superadmin = await server.login(SEED_USERS.superadmin);
});
afterAll(() => server.close());

async function chat(
  body: { threadId?: string; message: string; retryOf?: string },
  cookie = cookies.ops,
  onEvent?: (e: ChatEvent) => void,
) {
  const res = await fetch(`${server.base}/api/chat`, {
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
      const block = buf.slice(0, k);
      buf = buf.slice(k + 2);
      if (!block.startsWith('data: ')) continue;
      const e = chatEventSchema.parse(JSON.parse(block.slice(6)));
      events.push(e);
      onEvent?.(e);
    }
  }
  return events;
}
const savedChat = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'thread_saved' && e.chat ? [e.chat] : []));
const api = (method: string, path: string, cookie = cookies.ops, body?: unknown) =>
  server.api(method as 'GET', path, { cookie, body, schema: z.unknown() });
const detail = async (id: string, cookie = cookies.ops) =>
  (
    await server.api('GET', `/api/chat/threads/${id}`, {
      cookie,
      schema: chatThreadDetailSchema,
    })
  ).body as ChatThreadDetail;

describe('F28-T1 first message, stored reply, transcript', () => {
  it('creates a thread with an auto title and stores both messages', async () => {
    const events = await chat({ message: 'Which vehicles have no GPS right now?' });
    const saved = savedChat(events);
    expect(saved).toHaveLength(2);
    expect(events[0]!.type).toBe('thread_saved');
    const { threadId, title } = saved[0]!;
    expect(threadId).toMatch(/^thr-/);
    expect(title.length).toBeGreaterThan(0);
    expect(saved[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(events.at(-1)!.type).toBe('done');

    const d = await detail(threadId);
    expect(d.thread).toMatchObject({ id: threadId, title, titleAuto: true, trimmed: false });
    expect(d.thread.preview).toBe('Which vehicles have no GPS right now?');
    expect(d.messages.map((m) => [m.role, m.outcome])).toEqual([
      ['user', 'done'],
      ['assistant', 'done'],
    ]);
    expect(d.messages[1]!.extras.chips?.length ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('the next turn sends the stored thread as the transcript', async () => {
    const first = savedChat(await chat({ message: 'hello there' }))[0]!;
    await chat({ threadId: first.threadId, message: 'and again' });
    const last = (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
      body: { messages: { role: string; content: unknown }[] };
    };
    const msgs = last.body.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(msgs[0])).toContain('hello there');
    expect(JSON.stringify(msgs[2])).toContain('and again');
    expect((await detail(first.threadId)).messages).toHaveLength(4);
  });

  it('the old `messages` body is gone (422)', async () => {
    const res = await api('POST', '/api/chat', cookies.ops, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(422);
  });
});

describe('F28-T2 list, rename, delete, cap, ownership', () => {
  it('list with q and paging; rename; delete; other user 404 everywhere', async () => {
    const { threadId } = savedChat(await chat({ message: 'Top drivers this week' }))[0]!;
    const list = chatThreadListSchema.parse((await api('GET', '/api/chat/threads')).body);
    expect(list.items[0]!.id).toBe(threadId);

    const renamed = await api('PATCH', `/api/chat/threads/${threadId}`, cookies.ops, {
      title: '  Driver league  ',
    });
    expect(chatThreadSummarySchema.parse(renamed.body)).toMatchObject({
      title: 'Driver league',
      titleAuto: false,
    });
    expect(
      (await api('PATCH', `/api/chat/threads/${threadId}`, cookies.ops, { title: ' ' })).status,
    ).toBe(422);
    const found = chatThreadListSchema.parse(
      (await api('GET', '/api/chat/threads?q=LEAGUE')).body,
    );
    expect(found.items.map((t) => t.id)).toEqual([threadId]);
    // A renamed thread keeps its title on the next turn.
    await chat({ threadId, message: 'more' });
    expect((await detail(threadId)).thread.title).toBe('Driver league');

    const other = cookies.superadmin;
    expect((await api('GET', `/api/chat/threads/${threadId}`, other)).status).toBe(404);
    expect((await api('PATCH', `/api/chat/threads/${threadId}`, other, { title: 'x' })).status).toBe(404);
    expect((await api('DELETE', `/api/chat/threads/${threadId}`, other)).status).toBe(404);
    expect((await api('POST', `/api/chat/threads/${threadId}/stop`, other)).status).toBe(404);
    expect((await api('POST', '/api/chat', other, { threadId, message: 'hi' })).status).toBe(404);
    const theirs = chatThreadListSchema.parse((await api('GET', '/api/chat/threads', other)).body);
    expect(theirs.items.some((t) => t.id === threadId)).toBe(false);

    expect((await api('DELETE', `/api/chat/threads/${threadId}`)).status).toBe(204);
    expect((await api('GET', `/api/chat/threads/${threadId}`)).status).toBe(404);
  });

  it('pages of 50 and the 200-thread cap drops the least recently updated', async () => {
    const store = server.ctx.chatThreads;
    const userId = 'u-superadmin';
    const first = store.create(userId, 'oldest');
    for (let k = 1; k < CHAT_THREADS_PER_USER; k++) store.create(userId, `t${k}`);
    const page1 = store.list(userId);
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = chatThreadListSchema.parse(
      (
        await api(
          'GET',
          `/api/chat/threads?before=${encodeURIComponent(page1.nextCursor!)}`,
          cookies.superadmin,
        )
      ).body,
    );
    expect(page2.items).toHaveLength(50);
    expect(page2.items.some((t) => page1.items.some((p) => p.id === t.id))).toBe(false);
    expect(() => store.summary(userId, first.id)).not.toThrow();
    store.create(userId, 'one too many');
    expect(() => store.summary(userId, first.id)).toThrow();
  });
});

describe('F28-T3 retry, stop, busy', () => {
  it('retry re-runs the failed turn in place; not_retryable otherwise', async () => {
    await api('POST', '/api/dev/assistant/script', cookies.ops, { steps: [{ error: 500 }] });
    const events = await chat({ message: 'hello there' });
    const { threadId, messages } = savedChat(events).at(-1)!;
    const failed = messages[1]!;
    expect(failed).toMatchObject({ outcome: 'error', errorCode: 'busy' });

    const again = await chat({ threadId, message: 'hello there', retryOf: failed.id });
    expect(again.at(-1)!.type).toBe('done');
    const d = await detail(threadId);
    expect(d.messages).toHaveLength(2);
    expect(d.messages[1]).toMatchObject({ id: failed.id, outcome: 'done' });

    const stale = await api('POST', '/api/chat', cookies.ops, {
      threadId,
      message: 'x',
      retryOf: failed.id,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'not_retryable' } });
  });

  it('Stop stores `stopped`; a second sender gets chat_busy', async () => {
    let threadId = '';
    let stopped: Promise<{ status: number }> | undefined;
    let busy: Promise<{ status: number; body: unknown }> | undefined;
    const events = await chat({ message: '[fake:slow]' }, cookies.ops, (e) => {
      if (e.type === 'thread_saved' && e.chat) threadId = e.chat.threadId;
      if (e.type === 'text' && !stopped) {
        busy = api('POST', '/api/chat', cookies.ops, { threadId, message: 'me too' });
        stopped = busy.then(() => api('POST', `/api/chat/threads/${threadId}/stop`));
      }
    });
    const b = await busy!;
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ error: { code: 'chat_busy' } });
    expect((await stopped!).status).toBe(204);
    expect(events.at(-1)!.type).toBe('thread_saved');
    const d = await detail(threadId);
    expect(d.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(d.messages[1]).toMatchObject({ outcome: 'stopped' });
  });
});
