import type { Notification } from '@shared/contract/index.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { sessionAs } from '@/features/auth/testing/fake-session';
import type { NotificationPage, NotificationsApi } from '../api/notifications-api.ts';
import { NotificationStore } from '../notification-store.ts';
import { MAX_TOASTS, NotificationToasts, type ToastApi } from '../notification-toasts.ts';
import { fakeEventsSocket, note } from '../testing/fake-notifications.ts';
import { bellLabel, formatBadge, NotificationStoreContext } from '../use-notifications.ts';
import { NotificationBell } from './notification-bell.tsx';

const fakeToasts = (): ToastApi & { shown: string[]; more: number[]; dismissed: string[] } => {
  const t = {
    shown: [] as string[],
    more: [] as number[],
    dismissed: [] as string[],
    show: vi.fn((n: Notification) => void t.shown.push(n.id)),
    showMore: vi.fn((count: number) => void t.more.push(count)),
    dismiss: vi.fn((id: string) => void t.dismissed.push(id)),
  };
  return t;
};

function stubDesktop(matches: boolean) {
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

async function renderBell(first: NotificationPage, toasts = fakeToasts()) {
  const session = await sessionAs('authenticated');
  const socket = fakeEventsSocket();
  const api: NotificationsApi = {
    list: vi.fn(async () => first),
    markRead: vi.fn(async () => ({ unreadCount: 0 })),
  };
  const store = new NotificationStore({ session, socket, api, batchMs: 0 });
  const root = createRootRoute({
    component: () => (
      <>
        <NotificationBell toasts={toasts} />
        <Outlet />
      </>
    ),
  });
  const live = createRoute({
    getParentRoute: () => root,
    path: 'live-tracking',
    validateSearch: (s: Record<string, unknown>): { vehicle?: string } =>
      typeof s.vehicle === 'string' ? { vehicle: s.vehicle } : {},
    component: () => <p>live page</p>,
  });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([home, live]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <SessionContext value={session}>
      <NotificationStoreContext value={store}>
        <RouterProvider router={router} />
      </NotificationStoreContext>
    </SessionContext>,
  );
  await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));
  return { store, socket, api, router, toasts };
}

const unreadPage = (n: number): NotificationPage => ({
  items: Array.from({ length: Math.min(n, 50) }, (_, i) => note(n - i)),
  nextCursor: n > 50 ? String(n - 49) : null,
  unreadCount: n,
});

beforeEach(() => stubDesktop(true));
afterEach(() => {
  // @ts-expect-error -- jsdom has no matchMedia; restore that.
  delete window.matchMedia;
});

describe('F15-T3: bell', () => {
  it('formats the badge 1–99, then 99+, and puts the count in the aria-label', () => {
    expect(formatBadge(0)).toBeNull();
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(99)).toBe('99');
    expect(formatBadge(100)).toBe('99+');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
    expect(bellLabel(0)).toBe('Notifications');
  });

  it('shows the unread count, and it rises with live arrivals', async () => {
    const { socket } = await renderBell(unreadPage(3));
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    expect(within(bell).getByTestId('notification-badge')).toHaveTextContent('3');
    act(() => socket.emit(note(4)));
    expect(
      await screen.findByRole('button', { name: 'Notifications, 4 unread' }),
    ).toBeInTheDocument();
  });

  it('shows 99+ above 99', async () => {
    await renderBell(unreadPage(150));
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('99+');
  });
});

describe('F15-T3: panel', () => {
  it('opens as a popover with tabs; Unread filters; Mark all read clears the badge', async () => {
    const user = userEvent.setup();
    const { api } = await renderBell({
      items: [note(3), note(2, { readAt: 1 }), note(1)],
      nextCursor: null,
      unreadCount: 2,
    });
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const panel = await screen.findByTestId('notification-panel');
    expect(within(panel).getAllByTestId('notification-item')).toHaveLength(3);
    await user.click(within(panel).getByRole('tab', { name: /Unread/ }));
    expect(within(panel).getAllByTestId('notification-item')).toHaveLength(2);
    expect(within(panel).getByRole('tab', { name: /Unread/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(panel).getByRole('button', { name: 'Mark all read' }));
    expect(api.markRead).toHaveBeenCalledWith({ all: true });
    expect(within(panel).getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('renders unknown kinds generically (never dropped)', async () => {
    const user = userEvent.setup();
    const odd = { ...note(1), kind: 'battery-swap', severity: 'info' } as unknown as Notification;
    await renderBell({ items: [odd], nextCursor: null, unreadCount: 1 });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    const item = await screen.findByTestId('notification-item');
    expect(item).toHaveTextContent('Notification');
    expect(item).toHaveTextContent(odd.title);
  });

  it('clicking an item marks it read and opens the vehicle', async () => {
    const user = userEvent.setup();
    const { api, router } = await renderBell(unreadPage(2));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const items = await screen.findAllByTestId('notification-item');
    await user.click(items[1]!);
    expect(api.markRead).toHaveBeenCalledWith({ ids: ['ntf-1'] });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/live-tracking'));
    expect(router.state.location.search).toEqual({ vehicle: 'v1' });
    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument();
  });

  it('reveals more rows and fetches the next page on the cursor', async () => {
    const user = userEvent.setup();
    const { api } = await renderBell(unreadPage(60));
    vi.mocked(api.list).mockResolvedValueOnce({
      items: Array.from({ length: 10 }, (_, i) => note(10 - i)),
      nextCursor: null,
      unreadCount: 60,
    });
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findAllByTestId('notification-item')).toHaveLength(50);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => expect(screen.getAllByTestId('notification-item')).toHaveLength(60));
    expect(api.list).toHaveBeenLastCalledWith({ cursor: '11', limit: 50 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('opens as a full-height sheet on mobile', async () => {
    stubDesktop(false);
    const user = userEvent.setup();
    await renderBell(unreadPage(1));
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(await within(dialog).findByTestId('notification-panel')).toBeInTheDocument();
  });
});

describe('F15-T3: toasts (D-098)', () => {
  it('toasts live warning/critical arrivals only, never the loaded page', async () => {
    const { socket, toasts } = await renderBell(unreadPage(5));
    expect(toasts.shown).toEqual([]);
    act(() => {
      socket.emit(note(6, { severity: 'info' }));
      socket.emit(note(7, { severity: 'warning' }));
    });
    await vi.waitFor(() => expect(toasts.shown).toEqual(['ntf-7']));
  });

  it('caps visible toasts at 3 and collapses the rest into "+N more"', () => {
    const t = fakeToasts();
    const open = vi.fn();
    const policy = new NotificationToasts(t, open);
    policy.push([note(1), note(2), note(3)]);
    expect(t.shown).toEqual(['ntf-1', 'ntf-2', 'ntf-3']);
    expect(policy.count).toBe(MAX_TOASTS);

    policy.push([note(4), note(5)]);
    // The oldest makes way for the summary: still 3 visible.
    expect(t.dismissed).toEqual(['ntf-1']);
    expect(t.more).toEqual([2]);
    expect(policy.count).toBe(MAX_TOASTS);
    policy.push([note(6)]);
    expect(t.more).toEqual([2, 3]);
    expect(t.shown).toHaveLength(3);

    // The summary opens the panel; an item toast opens its item.
    vi.mocked(t.showMore).mock.calls[0]![1].onOpen();
    expect(open).toHaveBeenLastCalledWith(null);
    vi.mocked(t.show).mock.calls[1]![1].onOpen();
    expect(open).toHaveBeenLastCalledWith(note(2));

    // Once the summary and an item close, new arrivals toast again.
    vi.mocked(t.showMore).mock.calls[1]![1].onClose();
    vi.mocked(t.show).mock.calls[1]![1].onClose();
    policy.push([note(7)]);
    expect(t.shown.at(-1)).toBe('ntf-7');
  });
});
