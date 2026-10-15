import type { ChatEvent, ChatRequest } from '@shared/contract/assistant.ts';
import type {
  ChangeSet,
  Dashboard,
  DashboardSummary,
  ThreadMessage,
} from '@shared/contract/dashboards.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { SessionContext } from '@/features/auth/session/use-session';
import { sessionAs } from '@/features/auth/testing/fake-session';
import { AssistantStore } from './assistant-store.ts';
import { ChatHttpError, type ChatTransport } from './chat-stream.ts';
import { AssistantPanel } from './components/assistant-panel.tsx';
import { MessageList } from './components/message-list.tsx';
import {
  DashboardChatStore,
  UNDO_GONE_TEXT,
  type DashboardChatStream,
} from './dashboard-chat-store.ts';
import { dashboardEvents } from './dashboard-events.ts';
import { AssistantStoreContext } from './use-assistant.ts';
import { DashboardChatDepsContext, useDashboardChat } from './use-dashboard-chat.ts';

const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  id: 'dash-1',
  ownerId: 'u-ops',
  ownerName: 'Ops User',
  title: 'Ops today',
  description: '',
  widgets: [],
  layout: { lg: [], md: [], sm: [] },
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  access: 'owner',
  ...over,
});
const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  id: 'dash-9',
  ownerId: 'u-ops',
  ownerName: 'Ops User',
  title: 'Fleet overview',
  description: '',
  widgetCount: 3,
  version: 1,
  updatedAt: 1,
  access: 'owner',
  shareCount: 0,
  ...over,
});
const change = (over: Partial<ChangeSet> = {}): ChangeSet => ({
  id: 'chg-1',
  summary: 'Added widget "Top idle vehicles" (w-1)',
  beforeVersion: 1,
  afterVersion: 2,
  undoneAt: null,
  undoable: true,
  ...over,
});
const msg = (
  seq: number,
  role: 'user' | 'assistant',
  over: Partial<ThreadMessage> = {},
): ThreadMessage => ({
  id: `msg-${seq}`,
  seq,
  role,
  text: role === 'user' ? `q${seq}` : `a${seq}`,
  chips: [],
  change: null,
  previews: [],
  createdAt: seq,
  outcome: 'done',
  ...over,
});
const changedEvent = (version: number): ChatEvent => ({
  type: 'dashboard_changed',
  dashboardId: 'dash-1',
  changeId: 'chg-2',
  version,
  label: 'Added widget: Top idle vehicles',
  summary: 'Added widget "Top idle vehicles" (w-2)',
  dashboard: dashboard({ version }),
});

/** A stream the test drives (like the F17 fake transport). */
function fakeStream() {
  const calls: { url: string; body: unknown; signal: AbortSignal }[] = [];
  let emit: (e: ChatEvent) => void = () => {};
  let finish: (err?: unknown) => void = () => {};
  const stream: DashboardChatStream = (url, body, onEvent, signal) => {
    calls.push({ url, body, signal });
    emit = onEvent;
    return new Promise<void>((resolve, reject) => {
      finish = (err) => (err ? reject(err) : resolve());
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  return {
    stream,
    calls,
    emit: (...events: ChatEvent[]) => act(() => events.forEach((e) => emit(e))),
    end: () => act(async () => finish()),
    fail: (err: unknown) => act(async () => finish(err)),
  };
}

function fakeRest(threads: ThreadMessage[][]) {
  const api = vi.fn(async (path: string, req?: { method?: string; body?: unknown }) => {
    if (path.endsWith('/thread'))
      return { messages: threads.length > 1 ? threads.shift()! : threads[0]! };
    if (path.includes('/undo')) return undoResult(path, req);
    if (path.endsWith('/chat/stop')) return undefined;
    throw new Error(`unexpected ${path}`);
  });
  let undoResult: (path: string, req?: unknown) => unknown = () => dashboard({ version: 3 });
  return {
    api: api as unknown as <T>(path: string) => Promise<T>,
    calls: api.mock.calls,
    onUndo: (fn: typeof undoResult) => (undoResult = fn),
  };
}

describe('F19-T9 DashboardChatStore', () => {
  it('loads, sends, folds events, calls onDashboardChanged and reconciles thread_saved', async () => {
    const rest = fakeRest([[msg(1, 'user'), msg(2, 'assistant', { change: change() })]]);
    const fake = fakeStream();
    const onDashboardChanged = vi.fn();
    const bus = vi.fn();
    const off = dashboardEvents.subscribe(bus);
    const store = new DashboardChatStore(
      'dash-1',
      { onDashboardChanged },
      { api: rest.api, stream: fake.stream },
    );
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', streaming: false });
    expect(store.getSnapshot().messages[1]!.change!.undoable).toBe(true);

    store.send('  make the ranking 30 days ');
    expect(fake.calls[0]).toMatchObject({
      url: '/api/dashboards/dash-1/chat',
      body: { message: 'make the ranking 30 days' },
    });
    expect(store.getSnapshot().messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    await fake.emit(
      { type: 'tool_start', id: 't1', name: 'update_widget', label: 'Updating widget…' },
      changedEvent(3),
      { type: 'tool_end', id: 't1', ok: true, summary: 'x' },
      { type: 'text', delta: 'Done.' },
    );
    expect(onDashboardChanged).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
      expect.objectContaining({ type: 'dashboard_changed', changeId: 'chg-2' }),
    );
    expect(bus).toHaveBeenCalledWith({ kind: 'changed', dashboardId: 'dash-1' });
    expect(store.getSnapshot().messages[3]).toMatchObject({ text: 'Done.', status: 'streaming' });

    const stored = [
      msg(3, 'user', { text: 'make the ranking 30 days' }),
      msg(4, 'assistant', {
        text: 'Done.',
        chips: [
          { tool: 'update_widget', label: 'Updated widget: Top idle vehicles', status: 'ok' },
        ],
        change: change({ id: 'chg-2', afterVersion: 3 }),
      }),
    ];
    await fake.emit(
      { type: 'thread_saved', messages: stored },
      { type: 'done', stopReason: 'end_turn' },
    );
    await fake.end();
    const s = store.getSnapshot();
    expect(s.streaming).toBe(false);
    expect(s.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4']);
    expect(s.messages[3]).toMatchObject({
      seq: 4,
      status: 'done',
      change: { id: 'chg-2', undoable: true },
    });
    // The earlier turn's chip loses Undo.
    expect(s.messages[1]!.change!.undoable).toBe(false);
    off();
  });

  it('Undo: 200 marks the chip undone and reports the dashboard; 409 shows a notice and reloads', async () => {
    const rest = fakeRest([[msg(1, 'user'), msg(2, 'assistant', { change: change() })]]);
    const onDashboardChanged = vi.fn();
    const store = new DashboardChatStore(
      'dash-1',
      { onDashboardChanged },
      { api: rest.api, stream: fakeStream().stream },
    );
    await store.load();
    await store.undo('chg-1', 2);
    expect(rest.calls.at(-1)).toEqual([
      '/api/dashboards/dash-1/changes/chg-1/undo',
      { method: 'POST', body: { version: 2 } },
    ]);
    expect(onDashboardChanged).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(store.getSnapshot().messages[1]!.change).toMatchObject({
      undoable: false,
      undoneAt: expect.any(Number),
    });

    const again = new DashboardChatStore(
      'dash-1',
      {},
      { api: rest.api, stream: fakeStream().stream },
    );
    await again.load();
    rest.onUndo(() => {
      throw new ApiError(409, 'not_undoable', 'nope');
    });
    const loads = rest.calls.filter(([p]) => p.endsWith('/thread')).length;
    await again.undo('chg-1');
    expect(again.getSnapshot().notice).toBe(UNDO_GONE_TEXT);
    expect(rest.calls.filter(([p]) => p.endsWith('/thread')).length).toBe(loads + 1);
  });

  it('Stop aborts and reloads; chat_busy shows its text; not_configured is flagged', async () => {
    const rest = fakeRest([[]]);
    const fake = fakeStream();
    const store = new DashboardChatStore('dash-1', {}, { api: rest.api, stream: fake.stream });
    await store.load();
    store.send('build it');
    store.stop();
    await act(async () => {});
    // D-155: the server is told first (stored as `stopped`), then the stream is aborted.
    expect(rest.calls.some(([p, r]) => p.endsWith('/chat/stop') && r?.method === 'POST')).toBe(
      true,
    );
    expect(fake.calls[0]!.signal.aborted).toBe(true);
    expect(store.getSnapshot().streaming).toBe(false);
    expect(rest.calls.filter(([p]) => p.endsWith('/thread')).length).toBe(2);

    // F27 (D-154): chat_busy is a notice naming who is asking; the prompt goes back to the composer.
    store.send('again');
    await fake.fail(new ChatHttpError(409, 'chat_busy', 'Priya is asking the assistant…'));
    const snap = store.getSnapshot();
    expect(snap.messages.some((m) => m.text === 'again')).toBe(false);
    expect(snap.messages.some((m) => m.error)).toBe(false);
    expect(snap.notice).toBe('Priya is asking the assistant…');
    expect(snap.restore).toBe('again');

    const sent = fake.calls.length;
    store.send('again');
    expect(fake.calls).toHaveLength(sent + 1);
    expect(store.getSnapshot().restore).toBeNull();
    await fake.emit({ type: 'error', code: 'not_configured', message: 'x' });
    await fake.end();
    expect(store.getSnapshot().notConfigured).toBe(true);
  });
});

describe('F19-T9 components', () => {
  function Harness({ onUndo }: { onUndo: (c: ChangeSet) => void }) {
    const { state } = useDashboardChat('dash-1');
    return (
      <MessageList
        messages={state.messages}
        onRetry={() => {}}
        onNavigate={() => {}}
        onUndo={onUndo}
        undoDisabled={state.streaming}
      />
    );
  }

  async function renderWith(node: React.ReactNode) {
    const session = await sessionAs('authenticated');
    const root = createRootRoute({ component: () => node });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: '/', component: () => null }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    return render(
      <SessionContext value={session}>
        <RouterProvider router={router} />
      </SessionContext>,
    );
  }

  it('useDashboardChat loads the thread; change chips show Undo / Undone', async () => {
    const rest = fakeRest([
      [
        msg(1, 'user'),
        msg(2, 'assistant', {
          chips: [{ tool: 'rename_dashboard', label: 'Renamed dashboard to "A"', status: 'ok' }],
          change: change({ id: 'chg-0', undoable: false, undoneAt: 5 }),
        }),
        msg(3, 'user'),
        msg(4, 'assistant', {
          chips: [
            { tool: 'get_dashboard', label: 'Reading dashboard…', status: 'ok' },
            { tool: 'add_widget', label: 'Added widget: Notes', status: 'ok' },
            { tool: 'add_widget', label: 'Not permitted: driver-list', status: 'error' },
          ],
          change: change(),
        }),
      ],
    ]);
    const onUndo = vi.fn();
    const deps = { api: rest.api, stream: fakeStream().stream };
    await renderWith(
      <DashboardChatDepsContext value={deps}>
        <Harness onUndo={onUndo} />
      </DashboardChatDepsContext>,
    );
    const chips = await screen.findAllByTestId('change-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveAttribute('data-undone', 'true');
    expect(screen.getByTestId('change-undone')).toHaveTextContent('Undone');
    expect(chips[2]).toHaveAttribute('data-status', 'error');
    expect(screen.getAllByTestId('change-undo')).toHaveLength(1);
    expect(screen.getAllByTestId('tool-chip')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('change-undo'));
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 'chg-1' }));
  });

  it('the global panel shows an "Open dashboard" card on dashboard_created', async () => {
    let emit: (e: ChatEvent) => void = () => {};
    const transport: ChatTransport = (_req: ChatRequest, onEvent) => {
      emit = onEvent;
      return new Promise<void>(() => {});
    };
    const store = new AssistantStore({ transport });
    const bus = vi.fn();
    const off = dashboardEvents.subscribe(bus);
    await renderWith(
      <AssistantStoreContext value={store}>
        <AssistantPanel onClose={() => {}} />
      </AssistantStoreContext>,
    );
    await screen.findByRole('textbox', { name: 'Message the assistant' });
    act(() => store.send('Build a dashboard'));
    act(() => emit({ type: 'dashboard_created', dashboard: summary(), url: '/dashboards/dash-9' }));
    const link = await screen.findByTestId('dashboard-link');
    expect(link).toHaveAttribute('href', '/dashboards/dash-9');
    expect(screen.getByTestId('dashboard-link-card')).toHaveTextContent('Fleet overview');
    expect(bus).toHaveBeenCalledWith({ kind: 'created', dashboardId: 'dash-9' });
    off();
  });

  it.each([
    ['error', 'busy', 'error'],
    ['interrupted', 'timeout', 'interrupted'],
    ['stopped', undefined, 'stopped'],
  ] as const)(
    'D-155: a stored %s turn shows Retry after a fresh load',
    async (outcome, errorCode, status) => {
      const rest = fakeRest([
        [msg(1, 'user'), msg(2, 'assistant', { outcome, ...(errorCode ? { errorCode } : {}) })],
      ]);
      await renderWith(
        <DashboardChatDepsContext value={{ api: rest.api, stream: fakeStream().stream }}>
          <Harness onUndo={() => {}} />
        </DashboardChatDepsContext>,
      );
      expect(await screen.findByTestId('assistant-retry')).toBeInTheDocument();
      expect(screen.getByTestId('assistant-message')).toHaveAttribute('data-status', status);
      if (outcome === 'error')
        expect(screen.getByTestId('assistant-error')).toHaveAttribute('data-code', 'busy');
    },
  );

  it('a stored failed turn shows the server message once (no credits), not "Something went wrong"', async () => {
    const credits =
      'The AI provider account is out of credits or over its spending limit. Ask an administrator.';
    const rest = fakeRest([
      [
        msg(1, 'user'),
        msg(2, 'assistant', {
          outcome: 'error',
          errorCode: 'failed',
          text: `Half\n\n(error: ${credits})`,
        }),
      ],
    ]);
    await renderWith(
      <DashboardChatDepsContext value={{ api: rest.api, stream: fakeStream().stream }}>
        <Harness onUndo={() => {}} />
      </DashboardChatDepsContext>,
    );
    expect(await screen.findByTestId('assistant-error')).toHaveTextContent(credits);
    expect(screen.getByTestId('assistant-message')).toHaveTextContent('Half');
    expect(screen.getByTestId('assistant-message').textContent).not.toContain('(error:');
  });

  it('D-155: the global panel keeps Retry when closed and reopened', async () => {
    const transport: ChatTransport = () => Promise.reject(new ChatHttpError(500, 'busy', 'x'));
    const store = new AssistantStore({ transport });
    const panel = () => (
      <AssistantStoreContext value={store}>
        <AssistantPanel onClose={() => {}} />
      </AssistantStoreContext>
    );
    const first = await renderWith(panel());
    await screen.findByRole('textbox', { name: 'Message the assistant' });
    await act(async () => store.send('Which vehicles have no GPS?'));
    expect(await screen.findByTestId('assistant-retry')).toBeInTheDocument();
    first.unmount();
    await renderWith(panel());
    expect(await screen.findByTestId('assistant-retry')).toBeInTheDocument();
    expect(screen.getAllByTestId('user-message')).toHaveLength(1);
  });
});

describe('D-155 DashboardChatStore retry after a reload', () => {
  it('sends retryOf, keeps one user message, and folds the stored reply in place', async () => {
    const failed = msg(2, 'assistant', { outcome: 'interrupted', text: 'Part' });
    const rest = fakeRest([[msg(1, 'user', { text: 'add a kpi' }), failed]]);
    const fake = fakeStream();
    const store = new DashboardChatStore('dash-1', {}, { api: rest.api, stream: fake.stream });
    await store.load();
    expect(store.getSnapshot().messages.at(-1)!.status).toBe('interrupted');
    store.retry();
    expect(fake.calls[0]!.body).toEqual({ message: 'add a kpi', retryOf: 'msg-2' });
    expect(store.getSnapshot().messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'streaming'],
    ]);
    await fake.emit(
      { type: 'text', delta: 'Done.' },
      {
        type: 'thread_saved',
        messages: [msg(1, 'user', { text: 'add a kpi' }), msg(2, 'assistant', { text: 'Done.' })],
      },
      { type: 'done', stopReason: 'end_turn' },
    );
    await fake.end();
    const s = store.getSnapshot();
    expect(s.messages.map((m) => [m.id, m.status])).toEqual([
      ['msg-1', 'done'],
      ['msg-2', 'done'],
    ]);
  });

  it('a 409 not_retryable reloads the thread instead of asking twice', async () => {
    const rest = fakeRest([
      [msg(1, 'user'), msg(2, 'assistant', { outcome: 'error', errorCode: 'failed' })],
      [msg(1, 'user'), msg(2, 'assistant')],
    ]);
    const fake = fakeStream();
    const store = new DashboardChatStore('dash-1', {}, { api: rest.api, stream: fake.stream });
    await store.load();
    store.retry();
    await fake.fail(
      new ChatHttpError(409, 'failed', 'Only the latest failed reply can be retried'),
    );
    await act(async () => {});
    expect(fake.calls).toHaveLength(1);
    expect(store.getSnapshot().messages.map((m) => [m.id, m.status])).toEqual([
      ['msg-1', 'done'],
      ['msg-2', 'done'],
    ]);
  });
});
