import type { ChatEvent } from '@shared/contract/assistant.ts';
import type {
  Dashboard,
  ThreadMessage,
  UpdateDashboardBody,
  Widget,
  WidgetPreview,
} from '@shared/contract/dashboards.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantStore } from '@/features/assistant/assistant-store';
import { AssistantPanel } from '@/features/assistant/components/assistant-panel';
import { DashboardChatDepsContext } from '@/features/assistant/use-dashboard-chat';
import { AssistantStoreContext } from '@/features/assistant/use-assistant';
import { SessionContext } from '@/features/auth/session/use-session';
import { sessionAs } from '@/features/auth/testing/fake-session';
import { ApiError } from '@/shared/api/api-client';
import { dashboardsApi } from './api/dashboards-api';
import { ChatDock } from './components/chat-dock';
import { DashboardSession } from './store/dashboard-session';

/** D-135 P-T4: preview cards in both chats, and the session's add op. */

const note: Widget = {
  id: 'w-prev1',
  type: 'text',
  title: 'Shift note',
  body: 'Hello from preview',
};
const preview = (over: Partial<WidgetPreview> = {}): WidgetPreview => ({
  id: 'pv-1',
  dashboardId: 'dash-1',
  widget: note,
  size: { w: 4, h: 2 },
  status: 'pending',
  createdAt: 1,
  ...over,
});
const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  id: 'dash-1',
  ownerId: 'u-1',
  ownerName: 'Super Admin',
  title: 'Ops today',
  description: '',
  widgets: [],
  layout: { lg: [], md: [], sm: [] },
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  access: 'owner',
  ...over,
});
const assistantMsg = (previews: WidgetPreview[]): ThreadMessage => ({
  id: 'msg-2',
  seq: 2,
  role: 'assistant',
  text: 'Here is a preview.',
  chips: [{ tool: 'preview_widget', label: 'Previewed widget: Shift note', status: 'ok' }],
  change: null,
  previews,
  createdAt: 2,
  outcome: 'done',
});

function fakeDashApi(start: Dashboard) {
  let server = start;
  const patch = vi.fn(async (_id: string, body: UpdateDashboardBody) => {
    if (body.version !== server.version) throw new ApiError(409, 'version_conflict', 'changed');
    const { version: _v, ...rest } = body;
    void _v;
    server = { ...server, ...(rest as Partial<Dashboard>), version: server.version + 1 };
    return server;
  });
  return { get: vi.fn(async () => server), patch };
}

async function renderInRouter(node: () => ReactNode) {
  const session = await sessionAs('authenticated');
  const root = createRootRoute({ component: node });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => null }),
      createRoute({ getParentRoute: () => root, path: '/dashboards/$id', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <SessionContext value={session}>
      <RouterProvider router={router} />
    </SessionContext>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('D-135 DashboardSession.addWidget', () => {
  it('Add appends (server places it); a drop sends the breakpoint layout; limit rejects', async () => {
    const api = fakeDashApi(dash());
    const s = new DashboardSession('dash-1', api);
    await s.load();
    await s.addWidget(note);
    expect(api.patch).toHaveBeenLastCalledWith('dash-1', { version: 1, widgets: [note] });
    expect(s.version).toBe(2);

    const second: Widget = { ...note, id: 'w-prev2', title: 'Second' };
    await s.addWidget(second, {
      bp: 'lg',
      items: [
        { i: 'w-prev2', x: 0, y: 0, w: 4, h: 2 },
        { i: 'w-prev1', x: 0, y: 2, w: 4, h: 2 },
      ],
    });
    const body = api.patch.mock.calls.at(-1)![1] as Dashboard;
    expect(body.widgets.map((w) => w.id)).toEqual(['w-prev1', 'w-prev2']);
    expect(body.layout.lg).toEqual([
      { i: 'w-prev2', x: 0, y: 0, w: 4, h: 2 },
      { i: 'w-prev1', x: 0, y: 2, w: 4, h: 2 },
    ]);
    // Already on the dashboard: no second save.
    await s.addWidget(second);
    expect(api.patch).toHaveBeenCalledTimes(2);

    const full = new DashboardSession(
      'dash-1',
      fakeDashApi(
        dash({
          widgets: Array.from({ length: 24 }, (_, n) => ({ ...note, id: `w-n${n}` })),
        }),
      ),
    );
    await full.load();
    await expect(full.addWidget(second)).rejects.toMatchObject({ code: 'dashboard_limit' });
  });
});

describe('D-135 P-T4: preview card in the dashboard chat', () => {
  function setup() {
    const dashApi = fakeDashApi(dash());
    const session = new DashboardSession('dash-1', dashApi);
    const chatApi = vi.fn(async (...[path]: [string, unknown?]) => {
      if (path.endsWith('/thread'))
        return {
          messages: [
            {
              id: 'msg-1',
              seq: 1,
              role: 'user',
              text: 'add a small note',
              chips: [],
              change: null,
              previews: [],
              createdAt: 1,
            },
            assistantMsg([preview(), preview({ id: 'pv-2', widget: { ...note, id: 'w-prev2' } })]),
          ],
        };
      if (path.includes('/previews/')) return {};
      throw new Error(`unexpected ${path}`);
    });
    const deps = {
      api: chatApi as unknown as <T>(path: string) => Promise<T>,
      stream: () => new Promise<void>(() => {}),
    };
    // Mirrors the page: save the widget through the session, then record the card state.
    function Host() {
      const ref = useRef<((id: string, s: 'added' | 'discarded') => Promise<void>) | null>(null);
      return (
        <DashboardChatDepsContext value={deps}>
          <ChatDock
            dashboardId="dash-1"
            version={() => session.version}
            onAskConsumed={() => {}}
            onDashboardChanged={() => {}}
            previewStatusRef={ref}
            onAddPreview={async (p) => {
              await session.addWidget(p.widget);
              await ref.current?.(p.id, 'added');
            }}
          />
        </DashboardChatDepsContext>
      );
    }
    return { dashApi, session, chatApi, Host };
  }

  it('renders the widget; Add saves + PATCHes the card; Discard hides; Ask to change pre-fills', async () => {
    const { dashApi, session, chatApi, Host } = setup();
    await session.load();
    await renderInRouter(() => <Host />);
    const cards = await screen.findAllByTestId('widget-preview');
    expect(cards).toHaveLength(2);
    expect(await within(cards[0]!).findByText('Hello from preview')).toBeInTheDocument();

    await userEvent.click(within(cards[0]!).getByTestId('preview-add'));
    await waitFor(() =>
      expect(within(cards[0]!).getByTestId('preview-added')).toHaveTextContent('Added ✓'),
    );
    expect(within(cards[0]!).getByTestId('preview-added')).toBeDisabled();
    expect(dashApi.patch).toHaveBeenCalledWith('dash-1', { version: 1, widgets: [note] });
    expect(chatApi).toHaveBeenCalledWith('/api/dashboards/dash-1/previews/pv-1', {
      method: 'PATCH',
      body: { status: 'added' },
    });

    await userEvent.click(within(cards[1]!).getByTestId('preview-ask'));
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toHaveValue(
      'Change the "Shift note" preview: ',
    );

    await userEvent.click(within(cards[1]!).getByTestId('preview-discard'));
    await waitFor(() => expect(screen.getAllByTestId('widget-preview')).toHaveLength(1));
    expect(chatApi).toHaveBeenCalledWith('/api/dashboards/dash-1/previews/pv-2', {
      method: 'PATCH',
      body: { status: 'discarded' },
    });
  });

  it('a stored card state comes back from the thread (added / discarded)', async () => {
    const { session, chatApi, Host } = setup();
    chatApi.mockImplementation(async (path: string) => {
      if (path.endsWith('/thread'))
        return {
          messages: [
            assistantMsg([
              preview({ status: 'added' }),
              preview({ id: 'pv-2', status: 'discarded' }),
            ]),
          ],
        };
      return {};
    });
    await session.load();
    await renderInRouter(() => <Host />);
    const cards = await screen.findAllByTestId('widget-preview');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByTestId('preview-added')).toBeDisabled();
    expect(within(cards[0]!).queryByTestId('preview-add')).toBeNull();
  });
});

describe('D-135 P-T4: preview card in the global panel', () => {
  it('Add to dashboard… lists own dashboards + New; picking one saves and links it', async () => {
    const transport = vi.fn(async (_req: unknown, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'tool_start', id: 't1', name: 'preview_widget', label: 'Previewing…' });
      onEvent({ type: 'widget_preview', preview: preview({ dashboardId: null }) });
      onEvent({ type: 'tool_end', id: 't1', ok: true });
      onEvent({ type: 'text', delta: 'Here it is.' });
      onEvent({ type: 'done', stopReason: 'end_turn' });
    });
    const session = await sessionAs('authenticated');
    const store = new AssistantStore({ transport, session });
    const target = dash({ id: 'dash-7', title: 'Morning ops' });
    const api = fakeDashApi(target);
    vi.spyOn(dashboardsApi, 'list').mockResolvedValue({
      mine: [
        {
          id: 'dash-7',
          ownerId: 'u-1',
          ownerName: 'Super Admin',
          title: 'Morning ops',
          description: '',
          widgetCount: 0,
          version: 1,
          updatedAt: 1,
          access: 'owner',
          shareCount: 0,
        },
      ],
      sharedWithMe: [],
    });
    vi.spyOn(dashboardsApi, 'get').mockImplementation(api.get);
    vi.spyOn(dashboardsApi, 'patch').mockImplementation(api.patch);
    await renderInRouter(() => (
      <AssistantStoreContext value={store}>
        <AssistantPanel onClose={() => {}} />
      </AssistantStoreContext>
    ));
    act(() => store.send('add a small note'));
    const card = await screen.findByTestId('widget-preview');
    expect(within(card).queryByTestId('preview-add')).toBeNull();
    const trigger = within(card).getByTestId('preview-add-picker');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const item = await screen.findByTestId('picker-dashboard');
    expect(screen.getByTestId('picker-new')).toBeInTheDocument();
    await userEvent.click(item);
    await waitFor(() => expect(within(card).getByTestId('preview-added')).toBeInTheDocument());
    expect(api.patch).toHaveBeenCalledWith('dash-7', { version: 1, widgets: [note] });
    expect(within(card).getByTestId('preview-open-dashboard')).toHaveAttribute(
      'href',
      '/dashboards/dash-7',
    );
  });
});
