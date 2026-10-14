import type { Notification } from '@shared/contract/index.ts';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, sessionAs } from '@/features/auth/testing/fake-session';
import type { NotificationPage, NotificationsApi } from './api/notifications-api.ts';
import { NotificationStore } from './notification-store.ts';
import { fakeEventsSocket, note } from './testing/fake-notifications.ts';

const page = (items: Notification[], over: Partial<NotificationPage> = {}): NotificationPage => ({
  items,
  nextCursor: null,
  unreadCount: items.filter((n) => n.readAt === null).length,
  ...over,
});

function fakeNotificationsApi(first: NotificationPage = page([])): NotificationsApi {
  return {
    list: vi.fn(async () => first),
    markRead: vi.fn(async () => ({ unreadCount: 0 })),
  };
}

async function setup(api = fakeNotificationsApi()) {
  const session = await sessionAs('authenticated');
  const socket = fakeEventsSocket();
  const store = new NotificationStore({ session, socket, api, batchMs: 10 });
  const release = store.retain();
  await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));
  return { store, socket, api, session, release };
}

describe('F15-T1: notification-store', () => {
  it('loads the first page on sign-in and subscribes to the events socket', async () => {
    const { store, socket, api } = await setup(fakeNotificationsApi(page([note(2), note(1)])));
    expect(api.list).toHaveBeenCalledWith({ limit: 50 });
    expect(store.getSnapshot().items.map((n) => n.id)).toEqual(['ntf-2', 'ntf-1']);
    expect(store.getSnapshot().unreadCount).toBe(2);
    expect(socket.listeners).toBe(2);
  });

  it('prepends live arrivals in one batch, dedupes by id and counts unread', async () => {
    const { store, socket } = await setup(fakeNotificationsApi(page([note(1)])));
    const live = vi.fn();
    store.onLive(live);
    const renders = vi.fn();
    store.subscribe(renders);
    socket.emit(note(2));
    socket.emit(note(3));
    socket.emit(note(2));
    socket.emit(note(1));
    expect(renders).not.toHaveBeenCalled();
    store.flush();
    expect(renders).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().items.map((n) => n.id)).toEqual(['ntf-3', 'ntf-2', 'ntf-1']);
    expect(store.getSnapshot().unreadCount).toBe(3);
    expect(live).toHaveBeenCalledWith([note(3), note(2)]);
  });

  it('applies a batch on its own after batchMs', async () => {
    const { store, socket } = await setup();
    socket.emit(note(5));
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(1));
  });

  it('mark read is optimistic and rolls back on error', async () => {
    const api = fakeNotificationsApi(page([note(2), note(1)]));
    const { store } = await setup(api);
    let fail!: (e: Error) => void;
    vi.mocked(api.markRead).mockImplementationOnce(() => new Promise((_, r) => (fail = r)));
    const done = store.markRead('ntf-1');
    expect(store.getSnapshot().items[1]!.readAt).not.toBeNull();
    expect(store.getSnapshot().unreadCount).toBe(1);
    fail(new Error('500'));
    await done;
    expect(store.getSnapshot().items[1]!.readAt).toBeNull();
    expect(store.getSnapshot().unreadCount).toBe(2);
    expect(api.markRead).toHaveBeenCalledWith({ ids: ['ntf-1'] });
  });

  it('mark read keeps the server count on success; already-read items are a no-op', async () => {
    const api = fakeNotificationsApi(page([note(2), note(1, { readAt: 5 })]));
    vi.mocked(api.markRead).mockResolvedValue({ unreadCount: 7 });
    const { store } = await setup(api);
    await store.markRead('ntf-1');
    expect(api.markRead).not.toHaveBeenCalled();
    await store.markRead('ntf-2');
    expect(store.getSnapshot().unreadCount).toBe(7);
  });

  it('mark all read clears every item and rolls back on error', async () => {
    const api = fakeNotificationsApi(page([note(3), note(2), note(1, { readAt: 5 })]));
    const { store } = await setup(api);
    vi.mocked(api.markRead).mockRejectedValueOnce(new Error('offline'));
    const done = store.markAllRead();
    expect(store.getSnapshot().unreadCount).toBe(0);
    expect(store.getSnapshot().items.every((n) => n.readAt !== null)).toBe(true);
    await done;
    expect(store.getSnapshot().unreadCount).toBe(2);
    expect(store.getSnapshot().items.map((n) => n.readAt)).toEqual([null, null, 5]);
    await store.markAllRead();
    expect(api.markRead).toHaveBeenLastCalledWith({ all: true });
    expect(store.getSnapshot().unreadCount).toBe(0);
  });

  it('merges older pages on the cursor without duplicates', async () => {
    const api = fakeNotificationsApi(page([note(4), note(3)], { nextCursor: '3', unreadCount: 4 }));
    const { store } = await setup(api);
    vi.mocked(api.list).mockResolvedValueOnce(page([note(3), note(2), note(1)]));
    await store.loadMore();
    expect(api.list).toHaveBeenLastCalledWith({ cursor: '3', limit: 50 });
    const s = store.getSnapshot();
    expect(s.items.map((n) => n.id)).toEqual(['ntf-4', 'ntf-3', 'ntf-2', 'ntf-1']);
    expect(s.nextCursor).toBeNull();
    expect(s.unreadCount).toBe(4);
    await store.loadMore();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('keeps live arrivals that came before the first page', async () => {
    const session = await sessionAs('authenticated');
    const socket = fakeEventsSocket();
    let resolve!: (p: NotificationPage) => void;
    const api = fakeNotificationsApi();
    vi.mocked(api.list).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const store = new NotificationStore({ session, socket, api, batchMs: 10 });
    store.retain();
    socket.emit(note(9));
    resolve(page([note(2), note(1)]));
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'));
    expect(store.getSnapshot().items.map((n) => n.id)).toEqual(['ntf-9', 'ntf-2', 'ntf-1']);
    expect(store.getSnapshot().unreadCount).toBe(3);
  });

  it('re-syncs after a reconnect: adds missed items, takes read state from the server', async () => {
    const api = fakeNotificationsApi(page([note(3), note(2), note(1)]));
    const { store, socket } = await setup(api);
    const live = vi.fn();
    store.onLive(live);
    socket.sync(false);
    expect(api.list).toHaveBeenCalledTimes(1);
    // Offline meanwhile: ntf-4 arrived, another tab read ntf-2.
    vi.mocked(api.list).mockResolvedValueOnce(page([note(4), note(3), note(1)]));
    socket.sync(true);
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(4));
    expect(api.list).toHaveBeenLastCalledWith({ unread: true, limit: 50 });
    const s = store.getSnapshot();
    expect(s.items.map((n) => [n.id, n.readAt === null])).toEqual([
      ['ntf-4', true],
      ['ntf-3', true],
      ['ntf-2', false],
      ['ntf-1', true],
    ]);
    expect(s.unreadCount).toBe(3);
    expect(live).toHaveBeenCalledWith([note(4)]);
  });

  it('resets on sign-out and stops listening; a release drops the socket handlers', async () => {
    const { store, socket, session, release } = await setup(fakeNotificationsApi(page([note(1)])));
    await session.logout();
    expect(store.getSnapshot().items).toEqual([]);
    expect(socket.listeners).toBe(0);
    socket.emit(note(2));
    store.flush();
    expect(store.getSnapshot().items).toEqual([]);
    release();
  });

  it('a failed first load shows the error state; reload retries', async () => {
    const api = fakeNotificationsApi(page([note(1)]));
    vi.mocked(api.list).mockRejectedValueOnce(new Error('offline'));
    const session = await sessionAs('authenticated', fakeApi());
    const store = new NotificationStore({ session, socket: fakeEventsSocket(), api });
    store.retain();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('error'));
    await store.reload();
    expect(store.getSnapshot().status).toBe('ready');
    expect(store.getSnapshot().items).toHaveLength(1);
  });
});
