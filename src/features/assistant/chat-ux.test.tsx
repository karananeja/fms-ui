import type { ChatEvent } from '@shared/contract/assistant.ts';
import type { DashboardSummary, ThreadMessage } from '@shared/contract/dashboards.ts';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { arrange, parseListSearch } from '@/features/dashboards/lib/list-search';
import type { ChatError } from './assistant-store.ts';
import { formatElapsed, progressLabel, turnActivity, turnFailure } from './chat-progress.ts';
import { ChatStreamCutError, streamSse } from './chat-stream.ts';
import { Composer } from './components/composer.tsx';
import { DashboardChatStore, type DashboardChatStream } from './dashboard-chat-store.ts';
import {
  entitySuggestions,
  highlight,
  lastToken,
  matchPrompts,
  PROMPT_TEMPLATES,
} from './prompt-suggestions.ts';
import { EntitySourceContext, type EntitySource } from './use-prompt-suggestions.ts';

afterEach(() => vi.unstubAllGlobals());

const enc = new TextEncoder();
/** A fetch whose SSE body sends `chunks`, then ends or errors (a dropped connection). */
function sseFetch(chunks: string[], cut: boolean) {
  return vi.fn(async () => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]!));
        else if (cut) c.error(new TypeError('network error'));
        else c.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
}

describe('F23-T1 stream end detection', () => {
  it('skips `: ping` heartbeats and reports a mid-stream drop as ChatStreamCutError', async () => {
    const got: ChatEvent[] = [];
    vi.stubGlobal(
      'fetch',
      sseFetch([': ping\n\n', 'data: {"type":"text","delta":"Hi"}\n\n', ': ping\n\n'], true),
    );
    await expect(
      streamSse('/api/chat', {}, (e) => got.push(e), new AbortController().signal),
    ).rejects.toBeInstanceOf(ChatStreamCutError);
    expect(got).toEqual([{ type: 'text', delta: 'Hi' }]);
  });

  it('a clean end with heartbeats still delivers every event', async () => {
    const got: ChatEvent[] = [];
    vi.stubGlobal(
      'fetch',
      sseFetch([': ping\n\ndata: {"type":"done","stopReason":"end_turn"}\n\n'], false),
    );
    await streamSse('/x', {}, (e) => got.push(e), new AbortController().signal);
    expect(got.map((e) => e.type)).toEqual(['done']);
  });
});

const msg = (seq: number, role: 'user' | 'assistant', over: Partial<ThreadMessage> = {}) =>
  ({
    id: `msg-${seq}`,
    seq,
    role,
    text: role === 'user' ? `q${seq}` : `a${seq}`,
    chips: [],
    change: null,
    previews: [],
    createdAt: seq,
    ...over,
  }) as ThreadMessage;

function dashStore(thread: () => ThreadMessage[]) {
  let emit: (e: ChatEvent) => void = () => {};
  let finish: (err?: unknown) => void = () => {};
  const bodies: unknown[] = [];
  const stream: DashboardChatStream = (_u, body, onEvent) => {
    bodies.push(body);
    emit = onEvent;
    return new Promise<void>((res, rej) => (finish = (err) => (err ? rej(err) : res())));
  };
  const api = (async () => ({ messages: thread() })) as unknown as <T>(p: string) => Promise<T>;
  const store = new DashboardChatStore('dash-1', {}, { api, stream });
  return { store, bodies, emit: (e: ChatEvent) => emit(e), finish: (err?: unknown) => finish(err) };
}

describe('F23-T2 dashboard chat: Interrupted', () => {
  it('keeps the stored turn (chips + Undo) marked interrupted; Retry re-sends', async () => {
    let thread = [msg(1, 'user'), msg(2, 'assistant')];
    const t = dashStore(() => thread);
    await t.store.load();
    t.store.send('add a kpi');
    t.emit({ type: 'text', delta: 'Adding' });
    thread = [
      ...thread,
      msg(3, 'user', { text: 'add a kpi' }),
      msg(4, 'assistant', {
        text: 'Adding',
        chips: [{ tool: 'add_widget', label: 'Added widget: KPI', status: 'ok' }],
        change: {
          id: 'c1',
          summary: 's',
          beforeVersion: 1,
          afterVersion: 2,
          undoneAt: null,
          undoable: true,
        },
      }),
    ];
    t.finish(new ChatStreamCutError());
    await waitFor(() => expect(t.store.getSnapshot().messages).toHaveLength(4));
    const last = t.store.getSnapshot().messages.at(-1)!;
    expect(last).toMatchObject({ id: 'msg-4', status: 'interrupted', text: 'Adding' });
    expect(last.change?.undoable).toBe(true);
    t.store.retry();
    // D-155: the stored turn is re-run in place (no second user message).
    expect(t.bodies.at(-1)).toEqual({ message: 'add a kpi', retryOf: 'msg-4' });
  });

  it('keeps the local pair when the server did not store the turn', async () => {
    const t = dashStore(() => [msg(1, 'user'), msg(2, 'assistant')]);
    await t.store.load();
    t.store.send('hello');
    t.emit({ type: 'text', delta: 'Part' });
    t.finish();
    await waitFor(() => expect(t.store.getSnapshot().streaming).toBe(false));
    await act(async () => {});
    const ms = t.store.getSnapshot().messages;
    expect(ms.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(ms.at(-1)).toMatchObject({ status: 'interrupted', text: 'Part' });
  });
});

describe('F23-T3 progress helpers', () => {
  it('labels the current step and formats elapsed time', () => {
    expect(progressLabel({ text: '' })).toBe('Thinking…');
    expect(
      progressLabel({
        text: '',
        tools: [{ id: '1', name: 'find_vehicles', label: 'Looking up vehicles', ok: null }],
      }),
    ).toBe('Looking up vehicles…');
    expect(progressLabel({ text: 'Hi' })).toBe('Writing the answer…');
    expect(formatElapsed(4200)).toBe('4s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
  });

  it('a turn is "changing" while a mutating tool runs or after a change', () => {
    const tools = [{ id: '1', name: 'add_widget', label: 'Adding widget', ok: null }];
    expect(turnActivity(true, { status: 'streaming', tools, change: null }).changing).toBe(true);
    expect(turnActivity(true, { status: 'streaming', tools: [], change: null }).changing).toBe(
      false,
    );
    expect(turnActivity(false, { status: 'done', tools, change: null }).changing).toBe(false);
  });

  it('D-158: the canvas failure follows the last reply (settings link only for setup problems)', () => {
    const a = (status: string, error: ChatError | null = null) => ({
      role: 'assistant',
      status,
      error,
    });
    expect(turnFailure(undefined)).toBeNull();
    expect(turnFailure(a('done'))).toBeNull();
    expect(turnFailure({ role: 'user', status: 'done', error: null })).toBeNull();
    expect(turnFailure(a('interrupted'))).toMatchObject({ retryable: true, setup: false });
    const rejected =
      'The AI provider rejected the request (HTTP 400). Check the model chosen in AI settings, or ask an administrator.';
    expect(turnFailure(a('error', { code: 'failed', message: rejected }))).toEqual({
      message: rejected,
      retryable: true,
      setup: true,
    });
    expect(turnFailure(a('error', { code: 'busy', message: 'x' }))).toMatchObject({
      message: 'Assistant is busy, try again',
      setup: false,
    });
    expect(turnFailure(a('error', { code: 'refusal', message: '' }))?.retryable).toBe(false);
  });
});

describe('F23-T4 list search and sort', () => {
  const d = (id: string, title: string, widgetCount: number, updatedAt: number) =>
    ({ id, title, widgetCount, updatedAt, description: '', ownerName: 'Ops' }) as DashboardSummary;
  const list = [d('a', 'Beta', 1, 3), d('b', 'alpha', 5, 1), d('c', 'Gamma ops', 2, 2)];
  it('filters by title/owner and sorts recent, name, widgets', () => {
    expect(arrange(list, '', 'recent').map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(arrange(list, '', 'name').map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(arrange(list, '', 'widgets').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(arrange(list, 'gam', 'recent').map((x) => x.id)).toEqual(['c']);
    expect(arrange(list, 'ops', 'recent')).toHaveLength(3);
  });
  it('parses only known URL values', () => {
    expect(parseListSearch({ tab: 'shared', q: 'x', sort: 'name', view: 'list' })).toEqual({
      tab: 'shared',
      q: 'x',
      sort: 'name',
      view: 'list',
    });
    expect(parseListSearch({ tab: 'nope', sort: 'recent', view: 'grid', q: ' ' })).toEqual({});
  });
});

describe('F23-T10 type-ahead matching', () => {
  it('matches every typed word on word starts (or keywords), best first, highlighted', () => {
    const got = matchPrompts('top idl', PROMPT_TEMPLATES);
    expect(got[0]!.label).toBe('Top 10 vehicles by idle time this week');
    expect(got[0]!.match).toEqual([0, 3]);
    expect(matchPrompts('gps', PROMPT_TEMPLATES).map((s) => s.label)).toContain(
      'Which vehicles have no GPS right now?',
    );
    expect(matchPrompts('zzz', PROMPT_TEMPLATES)).toEqual([]);
    expect(matchPrompts('a', PROMPT_TEMPLATES)).toEqual([]);
    expect(matchPrompts('battery', PROMPT_TEMPLATES).length).toBeLessThanOrEqual(5);
    expect(highlight('Show open breakdown requests', ['break'])).toEqual([10, 15]);
  });

  it('completes the last word with a vehicle or a fleet', () => {
    expect(lastToken('where is KA0')).toEqual({ token: 'KA0', start: 9 });
    const s = entitySuggestions(
      'where is ka01',
      [{ vehicleId: 'v1', regno: 'KA01AB1234', vin: 'VIN1' }],
      [{ id: 'f1', name: 'North' }],
    );
    expect(s[0]).toMatchObject({ kind: 'vehicle', insert: 'where is KA01AB1234 ', match: [0, 4] });
    expect(entitySuggestions('idle in nor', [], [{ id: 'f1', name: 'North' }])[0]).toMatchObject({
      kind: 'fleet',
      insert: 'idle in North fleet ',
    });
  });
});

describe('F23-T11 composer type-ahead keyboard', () => {
  async function renderComposer(permissions?: Parameters<typeof fakeMe>[2]) {
    const session = await sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'A', permissions));
    const onSend = vi.fn();
    const source: EntitySource = {
      vehicles: async () => [{ vehicleId: 'v1', regno: 'KA01AB1234', vin: 'VIN1' }],
      fleets: () => [{ id: 'f1', name: 'North' }],
    };
    render(
      <SessionContext value={session}>
        <EntitySourceContext value={source}>
          <Composer streaming={false} onSend={onSend} onStop={() => {}} suggestions="global" />
        </EntitySourceContext>
      </SessionContext>,
    );
    const box = screen.getByRole('textbox', { name: 'Message the assistant' });
    return { box, onSend, user: userEvent.setup() };
  }

  it('↓ highlights, Enter accepts (no send), Enter again sends; Esc closes', async () => {
    const t = await renderComposer();
    await t.user.type(t.box, 'top idl');
    const list = await screen.findByRole('listbox', { name: 'Suggestions' });
    expect(t.box).not.toHaveAttribute('aria-activedescendant');
    await t.user.keyboard('{ArrowDown}');
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(t.box).toHaveAttribute('aria-activedescendant', first.id);
    expect(list.querySelector('mark')).toHaveTextContent('Top');
    await t.user.keyboard('{Enter}');
    expect(t.box).toHaveValue('Top 10 vehicles by idle time this week');
    expect(t.onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    await t.user.keyboard('{Enter}');
    expect(t.onSend).toHaveBeenCalledWith('Top 10 vehicles by idle time this week');

    await t.user.type(t.box, 'gps');
    await screen.findByRole('listbox');
    await t.user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter with nothing highlighted sends; Tab accepts the first; click accepts', async () => {
    const t = await renderComposer();
    await t.user.type(t.box, 'gps');
    await screen.findByRole('listbox');
    await t.user.keyboard('{Enter}');
    expect(t.onSend).toHaveBeenCalledWith('gps');

    await t.user.type(t.box, 'where is ka01');
    const opt = await screen.findByRole('option', { name: /KA01AB1234/ });
    expect(opt).toHaveAttribute('data-kind', 'vehicle');
    await t.user.keyboard('{Tab}');
    expect(t.box).toHaveValue('where is KA01AB1234 ');

    await t.user.clear(t.box);
    await t.user.type(t.box, 'idle in nor');
    await t.user.click(await screen.findByRole('option', { name: /North/ }));
    expect(t.box).toHaveValue('idle in North fleet ');
  });

  it('only offers prompts the user is allowed to see', async () => {
    const t = await renderComposer(['chat.use', 'requests.manage']);
    await t.user.type(t.box, 'show');
    const opts = await screen.findAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['Show open breakdown requests']);
  });
});
