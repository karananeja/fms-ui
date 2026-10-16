import type {
  ChatEvent,
  ChatRequest,
  ChatThreadMessage,
  ReportDescriptor,
} from '@shared/contract/assistant.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { AssistantStore } from './assistant-store.ts';
import { ChatHttpError, SseParser, type ChatTransport } from './chat-stream.ts';
import { AssistantPanel } from './components/assistant-panel.tsx';
import { AssistantStoreContext } from './use-assistant.ts';

/** A transport the test drives: `emit` events, then `end()` (or the store aborts it). */
function fakeTransport() {
  const requests: ChatRequest[] = [];
  let emit: (e: ChatEvent) => void = () => {};
  let finish: (err?: unknown) => void = () => {};
  const signals: AbortSignal[] = [];
  const transport: ChatTransport = (req, onEvent, signal) => {
    requests.push(req);
    signals.push(signal);
    emit = onEvent;
    return new Promise<void>((resolve, reject) => {
      finish = (err) => (err ? reject(err) : resolve());
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  return {
    transport,
    requests,
    signals,
    emit: (...events: ChatEvent[]) => act(() => events.forEach((e) => emit(e))),
    end: () => act(async () => finish()),
    fail: (err: unknown) => act(async () => finish(err)),
  };
}

const report = (over: Partial<ReportDescriptor> = {}): ReportDescriptor => ({
  id: 'r1',
  kind: 'no-gps',
  format: 'csv',
  filename: 'no-gps-vehicles.csv',
  rows: 1234,
  url: '/api/chat/reports/r1',
  expiresAt: Date.now() + 15 * 60_000,
  ...over,
});

const stored = (
  id: string,
  seq: number,
  role: 'user' | 'assistant',
  text: string,
  outcome: ChatThreadMessage['outcome'] = 'done',
): ChatThreadMessage => ({
  id,
  seq,
  role,
  text,
  extras: {},
  outcome,
  errorCode: outcome === 'error' ? 'failed' : null,
  createdAt: 1,
});

async function renderPanel() {
  const fake = fakeTransport();
  const session = await sessionAs('authenticated');
  const store = new AssistantStore({
    transport: fake.transport,
    session,
    api: (async () => ({ items: [], nextCursor: null })) as never,
    memory: { get: () => null, set: () => {} },
  });
  const onClose = vi.fn();
  const root = createRootRoute({
    component: () => (
      <AssistantStoreContext value={store}>
        <AssistantPanel onClose={onClose} />
      </AssistantStoreContext>
    ),
  });
  const routes = ['live-tracking', 'analytics'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([home, ...routes]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <SessionContext value={session}>
      <RouterProvider router={router} />
    </SessionContext>,
  );
  const box = await screen.findByRole('textbox', { name: 'Message the assistant' });
  return { ...fake, store, session, router, onClose, box, user: userEvent.setup() };
}

describe('F17: SSE parser', () => {
  it('parses data lines across chunk boundaries and skips junk', () => {
    const got: ChatEvent[] = [];
    const p = new SseParser((e) => got.push(e));
    p.push('data: {"type":"text","delta":"Hel');
    p.push('lo"}\n\n: comment\n\ndata: not json\n\ndata: {"type":"bogus"}\r\n\r\n');
    p.push('event: x\ndata: {"type":"done","stopReason":"end_turn"}');
    p.end();
    expect(got).toEqual([
      { type: 'text', delta: 'Hello' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});

describe('F17: store', () => {
  it('F28: sends only the new message; adopts thread_saved; Retry re-runs a stored failure', async () => {
    const fake = fakeTransport();
    const store = new AssistantStore({
      transport: fake.transport,
      memory: { get: () => null, set: () => {} },
    });
    store.send('q1');
    expect(fake.requests[0]).toEqual({ message: 'q1' });
    await fake.emit({
      type: 'thread_saved',
      messages: [],
      chat: { threadId: 'thr-1', title: 'Q1', messages: [stored('msg-u1', 1, 'user', 'q1')] },
    });
    await fake.emit(
      { type: 'text', delta: 'a1' },
      {
        type: 'thread_saved',
        messages: [],
        chat: {
          threadId: 'thr-1',
          title: 'Q1',
          messages: [
            stored('msg-u1', 1, 'user', 'q1'),
            stored('msg-a1', 2, 'assistant', 'a1\n\n(error: boom)', 'error'),
          ],
        },
      },
      { type: 'error', code: 'failed', message: 'boom' },
    );
    await fake.end();
    const s = store.getSnapshot();
    expect(s.threadId).toBe('thr-1');
    expect(s.title).toBe('Q1');
    expect(s.messages.map((m) => m.id)).toEqual(['msg-u1', 'msg-a1']);
    store.retry();
    expect(fake.requests[1]).toEqual({ threadId: 'thr-1', message: 'q1', retryOf: 'msg-a1' });
    expect(store.getSnapshot().messages).toHaveLength(2);
    await fake.emit({ type: 'done', stopReason: 'end_turn' });
    await fake.end();
    store.send('q2');
    expect(fake.requests[2]).toEqual({ threadId: 'thr-1', message: 'q2' });
    store.clear();
    expect(store.getSnapshot()).toMatchObject({ threadId: null, messages: [] });
    store.send('q3');
    expect(fake.requests[3]).toEqual({ message: 'q3' });
  });

  it('F28: opens the tab’s last thread, else a thread updated < 12 h ago, else a new chat', async () => {
    const session = await sessionAs('authenticated');
    const now = Date.now();
    const thread = (id: string, updatedAt: number) => ({
      id,
      title: id,
      titleAuto: true,
      createdAt: updatedAt,
      updatedAt,
      preview: '',
      trimmed: false,
    });
    const make = (remembered: string | null | undefined, latestAge: number) => {
      const api = vi.fn(async (path: string) => {
        if (path === '/api/chat/threads')
          return { items: [thread('thr-latest', now - latestAge)], nextCursor: null };
        const id = path.split('/').at(-1)!;
        return { thread: thread(id, now), messages: [stored(`${id}-u`, 1, 'user', `hi ${id}`)] };
      });
      return new AssistantStore({
        session,
        api: api as never,
        memory: { get: () => remembered, set: () => {} },
      });
    };
    const a = make('thr-tab', 0);
    await a.open();
    expect(a.getSnapshot().threadId).toBe('thr-tab');
    const b = make(undefined, 60_000);
    await b.open();
    expect(b.getSnapshot().threadId).toBe('thr-latest');
    const c = make(undefined, 13 * 3_600_000);
    await c.open();
    expect(c.getSnapshot()).toMatchObject({ threadId: null, messages: [] });
    // New chat was the last choice in this tab: no resume.
    const d = make(null, 60_000);
    await d.open();
    expect(d.getSnapshot().threadId).toBeNull();
  });

  it('clears the conversation when the user changes (sign-out)', async () => {
    const api = fakeApi();
    const session = await sessionAs('authenticated', api, fakeMe());
    const fake = fakeTransport();
    const store = new AssistantStore({ transport: fake.transport, session });
    store.send('hello');
    expect(store.getSnapshot().messages).toHaveLength(2);
    await act(() => session.logout());
    expect(store.getSnapshot().messages).toHaveLength(0);
    expect(fake.signals[0]!.aborted).toBe(true);
  });

  it('a 401 ends the session; 429 shows busy', async () => {
    const fake = fakeTransport();
    const session = {
      subscribe: () => () => {},
      getSnapshot: () => ({ status: 'anonymous' as const, me: null }),
      expire: vi.fn(),
    };
    const store = new AssistantStore({ transport: fake.transport, session });
    store.send('q');
    await fake.fail(new ChatHttpError(401, 'failed', 'Sign in required'));
    expect(session.expire).toHaveBeenCalled();
    store.retry();
    await fake.fail(new ChatHttpError(429, 'busy', 'Too many'));
    const last = store.getSnapshot().messages.at(-1);
    expect(last?.role === 'assistant' && last.error?.code).toBe('busy');
  });
});

describe('F17-T5: panel', () => {
  it('shows suggested prompts; Enter sends, Shift+Enter adds a line', async () => {
    const t = await renderPanel();
    expect(screen.getAllByTestId('suggested-prompt').length).toBeGreaterThan(0);
    await t.user.type(t.box, 'first line{Shift>}{Enter}{/Shift}second');
    expect(t.box).toHaveValue('first line\nsecond');
    expect(t.requests).toHaveLength(0);
    await t.user.keyboard('{Enter}');
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]).toEqual({ message: 'first line\nsecond' });
    expect(t.box).toHaveValue('');
    expect(screen.getByTestId('user-message')).toHaveTextContent('first line second');
    expect(screen.queryByTestId('suggested-prompt')).toBeNull();
  });

  it('streams text with markdown, tool chips and entity links', async () => {
    const t = await renderPanel();
    await t.user.click(screen.getAllByTestId('suggested-prompt')[0]!);
    await t.emit({
      type: 'tool_start',
      id: 't1',
      name: 'get_vehicle',
      label: 'Looking up MH12AB1234…',
    });
    const chip = screen.getByTestId('tool-chip');
    expect(chip).toHaveAttribute('data-state', 'running');
    expect(chip).toHaveTextContent('Looking up MH12AB1234…');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await t.emit({ type: 'tool_end', id: 't1', ok: true });
    expect(chip).toHaveAttribute('data-state', 'ok');
    await t.emit({ type: 'text', delta: '**MH12AB1234** is running, driven by Karan Shah.\n\n' });
    await t.emit(
      {
        type: 'text',
        delta: '| Regno | Speed |\n|---|---|\n| MH12AB1234 | `42` km/h |\n\n- one\n- two',
      },
      {
        type: 'entities',
        items: [
          { kind: 'vehicle', id: 'v-9', label: 'MH12AB1234' },
          { kind: 'driver', id: 'd-1', label: 'Karan Shah' },
        ],
      },
      { type: 'done', stopReason: 'end_turn' },
    );
    await t.end();
    const answer = screen.getByTestId('assistant-message');
    expect(within(answer).getByRole('table')).toBeInTheDocument();
    expect(
      within(answer)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Looking up MH12AB1234…', 'one', 'two']);
    const links = within(answer).getAllByTestId('entity-link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/live-tracking?vehicle=v-9',
      '/analytics?tab=drivers&driver=d-1',
      '/live-tracking?vehicle=v-9',
    ]);
    expect(answer.querySelector('strong')).toContainElement(links[0]!);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();

    await t.user.click(links[0]!);
    expect(t.onClose).toHaveBeenCalled();
    expect(t.router.state.location.search).toEqual({ vehicle: 'v-9' });
  });

  it('Stop aborts the request and keeps the partial answer; Retry asks again', async () => {
    const t = await renderPanel();
    await t.user.type(t.box, 'Where is MH12?{Enter}');
    await t.emit({ type: 'tool_start', id: 't1', name: 'get_vehicle', label: 'Looking up…' });
    await t.emit({ type: 'text', delta: 'Partial' });
    await t.user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(t.signals[0]!.aborted).toBe(true);
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByTestId('tool-chip')).toHaveAttribute('data-state', 'failed');

    await t.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]).toEqual({ message: 'Where is MH12?' });
    expect(screen.queryByText('Partial')).toBeNull();
  });

  it('report card: file, rows, format, Download; expired link says so', async () => {
    const t = await renderPanel();
    await t.user.type(t.box, 'Export no-GPS vehicles as CSV{Enter}');
    await t.emit(
      { type: 'report', report: report() },
      {
        type: 'report',
        report: report({
          id: 'r2',
          format: 'pdf',
          filename: 'old.pdf',
          rows: 1,
          expiresAt: Date.now() - 1,
        }),
      },
      { type: 'done', stopReason: 'end_turn' },
    );
    await t.end();
    const [csv, pdf] = screen.getAllByTestId('report-card');
    expect(csv).toHaveTextContent('no-gps-vehicles.csv');
    expect(csv).toHaveTextContent('csv');
    expect(within(csv!).getByTestId('report-rows')).toHaveTextContent('1,234 rows');
    const dl = within(csv!).getByRole('link', { name: 'Download' });
    expect(dl).toHaveAttribute('href', '/api/chat/reports/r1');
    expect(dl).toHaveAttribute('download', 'no-gps-vehicles.csv');
    expect(pdf).toHaveTextContent('This report has expired. Ask again to rebuild it.');
    expect(within(pdf!).queryByRole('link')).toBeNull();
  });

  it('not configured: a set-up notice, no error alert, composer disabled until New chat', async () => {
    const t = await renderPanel();
    await t.user.type(t.box, 'hi{Enter}');
    await t.emit({ type: 'error', code: 'not_configured', message: 'No API key' });
    await t.end();
    expect(screen.getByTestId('assistant-not-configured')).toHaveTextContent(
      "Assistant isn't set up yet",
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(t.box).toBeDisabled();
    await t.user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByTestId('assistant-not-configured')).toBeNull();
    expect(t.box).toBeEnabled();
  });

  it('busy → message and Retry; refusal → polite line without Retry', async () => {
    const t = await renderPanel();
    await t.user.type(t.box, 'q1{Enter}');
    await t.emit({ type: 'error', code: 'busy', message: 'overloaded' });
    await t.end();
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant is busy, try again');
    await t.user.click(screen.getByRole('button', { name: 'Retry' }));
    await t.emit({ type: 'error', code: 'refusal', message: 'refused' });
    await t.end();
    expect(screen.getByTestId('assistant-error')).toHaveTextContent("I can't help with that.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('F23: a stream that ends without done is Interrupted (partial text kept, Retry)', async () => {
    const t = await renderPanel();
    await t.user.type(t.box, 'q{Enter}');
    await t.emit({ type: 'text', delta: 'Half' });
    await t.end();
    const answer = screen.getByTestId('assistant-message');
    expect(answer).toHaveAttribute('data-status', 'interrupted');
    expect(answer).toHaveTextContent('Half');
    expect(screen.getByTestId('assistant-interrupted')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-error')).toBeNull();
    await t.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(t.requests.at(-1)).toEqual({ message: 'q' });
  });
});
