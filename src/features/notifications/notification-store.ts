import type { Notification } from '@shared/contract/index.ts';
import { sessionStore } from '@/features/auth/session/session-store';
import {
  httpNotificationsApi,
  PAGE_SIZE,
  type NotificationPage,
  type NotificationsApi,
} from './api/notifications-api.ts';
import { eventsSocket, type EventsSocket, type SessionSource } from './events-socket.ts';

export type NotificationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NotificationState {
  status: NotificationStatus;
  /** Newest first (server order), unique by id. */
  items: readonly Notification[];
  /** Every unread notification the user may see (server count, kept live). */
  unreadCount: number;
  /** Cursor of the next older page, or `null` when everything is loaded. */
  nextCursor: string | null;
  loadingMore: boolean;
}

export interface NotificationStoreDeps {
  session: SessionSource;
  socket: Pick<EventsSocket, 'onEvent' | 'onSync' | 'now'>;
  api: NotificationsApi;
  /** Live arrivals are applied in one batch per this window (a burst renders once). */
  batchMs?: number;
}

const initial: NotificationState = {
  status: 'idle',
  items: [],
  unreadCount: 0,
  nextCursor: null,
  loadingMore: false,
};

/**
 * F15 / D-097: the signed-in user's notifications on the main thread (low volume; not the fleet
 * worker). Loads the first page on sign-in, prepends live `events` arrivals (deduped by id,
 * batched), re-syncs unread state over REST after a reconnect, and marks read optimistically.
 * Follows the session while retained (the bell retains it).
 */
export class NotificationStore {
  private state: NotificationState = initial;
  private readonly listeners = new Set<() => void>();
  private readonly liveListeners = new Set<(items: Notification[]) => void>();
  private readonly ids = new Set<string>();
  private pending: Notification[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retainCount = 0;
  private offSession: (() => void) | null = null;
  private offSocket: (() => void)[] = [];
  private userId: string | null = null;
  /** Bumped on every user change: responses for an older user are dropped. */
  private gen = 0;

  constructor(private readonly deps: NotificationStoreDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NotificationState => this.state;

  /** Server-corrected time for relative timestamps. */
  now(): number {
    return this.deps.socket.now();
  }

  /** Follows the session (and keeps the `events` socket open) until every release. */
  retain(): () => void {
    if (this.retainCount++ === 0) {
      this.offSession = this.deps.session.subscribe(this.followSession);
      this.followSession();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.retainCount > 0) return;
      this.offSession?.();
      this.offSession = null;
      this.switchUser(null);
    };
  }

  /** Live arrivals (after each batch), for toasts. Items loaded over REST are never reported. */
  onLive(listener: (items: Notification[]) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  /** First page again (also the "Retry" after a failed load). */
  async reload(): Promise<void> {
    const gen = this.gen;
    if (!this.userId) return;
    this.set({ status: 'loading' });
    try {
      const page = await this.deps.api.list({ limit: PAGE_SIZE });
      if (gen !== this.gen) return;
      this.flush();
      // Live arrivals newer than the page (it was built before they came) stay on top.
      const pageIds = new Set(page.items.map((n) => n.id));
      const liveOnly = this.state.items.filter((n) => !pageIds.has(n.id));
      const items = [...liveOnly, ...page.items];
      this.ids.clear();
      for (const n of items) this.ids.add(n.id);
      const liveUnread = liveOnly.filter((n) => n.readAt === null).length;
      this.set({
        status: 'ready',
        items,
        nextCursor: page.nextCursor,
        unreadCount: page.unreadCount + liveUnread,
      });
    } catch {
      if (gen === this.gen) this.set({ status: 'error' });
    }
  }

  /** Next older page (infinite scroll). */
  async loadMore(): Promise<void> {
    const { nextCursor, loadingMore } = this.state;
    if (!nextCursor || loadingMore) return;
    const gen = this.gen;
    this.set({ loadingMore: true });
    try {
      const page = await this.deps.api.list({ cursor: nextCursor, limit: PAGE_SIZE });
      if (gen !== this.gen) return;
      const older = page.items.filter((n) => !this.ids.has(n.id));
      for (const n of older) this.ids.add(n.id);
      this.set({
        items: [...this.state.items, ...older],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch {
      if (gen === this.gen) this.set({ loadingMore: false });
    }
  }

  /** F15-R6: optimistic; rolled back if the server refuses. */
  async markRead(id: string): Promise<void> {
    const at = this.now();
    let changed = false;
    const items = this.state.items.map((n) => {
      if (n.id !== id || n.readAt !== null) return n;
      changed = true;
      return { ...n, readAt: at };
    });
    if (!changed) return;
    const gen = this.gen;
    this.set({ items, unreadCount: Math.max(0, this.state.unreadCount - 1) });
    try {
      const res = await this.deps.api.markRead({ ids: [id] });
      if (gen === this.gen) this.set({ unreadCount: res.unreadCount });
    } catch {
      if (gen !== this.gen) return;
      this.set({
        items: this.state.items.map((n) => (n.id === id && n.readAt === at ? { ...n, readAt: null } : n)),
        unreadCount: this.state.unreadCount + 1,
      });
    }
  }

  /** "Mark all read": optimistic; rolled back if the server refuses. */
  async markAllRead(): Promise<void> {
    const { unreadCount: before } = this.state;
    if (before === 0 && this.state.items.every((n) => n.readAt !== null)) return;
    const at = this.now();
    const changed = new Set<string>();
    const items = this.state.items.map((n) => {
      if (n.readAt !== null) return n;
      changed.add(n.id);
      return { ...n, readAt: at };
    });
    const gen = this.gen;
    this.set({ items, unreadCount: 0 });
    try {
      const res = await this.deps.api.markRead({ all: true });
      if (gen === this.gen) this.set({ unreadCount: res.unreadCount });
    } catch {
      if (gen !== this.gen) return;
      this.set({
        items: this.state.items.map((n) =>
          changed.has(n.id) && n.readAt === at ? { ...n, readAt: null } : n,
        ),
        unreadCount: this.state.unreadCount + before,
      });
    }
  }

  /**
   * F15-R3/R6 after a reconnect: `GET ?unread` adds what was missed while offline and takes read
   * state from the server (another tab may have read items). Unread items the page covers but
   * doesn't list are marked read.
   */
  async resync(): Promise<void> {
    const gen = this.gen;
    if (!this.userId) return;
    let page: NotificationPage;
    try {
      page = await this.deps.api.list({ unread: true, limit: PAGE_SIZE });
    } catch {
      return;
    }
    if (gen !== this.gen) return;
    this.flush();
    const missed = page.items.filter((n) => !this.ids.has(n.id));
    for (const n of missed) this.ids.add(n.id);
    const items = [...missed, ...this.state.items];
    const unread = new Set(page.items.map((n) => n.id));
    const last = page.items.at(-1);
    const covered =
      page.nextCursor === null ? items.length : last ? items.findIndex((n) => n.id === last.id) : 0;
    const at = this.now();
    this.set({
      items: items.map((n, i) =>
        i < covered && n.readAt === null && !unread.has(n.id) ? { ...n, readAt: at } : n,
      ),
      unreadCount: page.unreadCount,
    });
    if (missed.length) this.emitLive(missed);
  }

  /** A live `notification` event: queued, deduped, applied in the next batch. */
  receive(n: Notification): void {
    if (this.ids.has(n.id) || !this.userId) return;
    this.ids.add(n.id);
    this.pending.push(n);
    this.flushTimer ??= setTimeout(() => this.flush(), this.deps.batchMs ?? 100);
  }

  /** Applies queued live arrivals now (tests; before any REST merge). */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pending.length) return;
    const arrived = this.pending.reverse();
    this.pending = [];
    this.set({
      items: [...arrived, ...this.state.items],
      unreadCount: this.state.unreadCount + arrived.filter((n) => n.readAt === null).length,
    });
    this.emitLive(arrived);
  }

  private emitLive(items: Notification[]): void {
    for (const l of this.liveListeners) l(items);
  }

  private followSession = (): void => {
    const { status, me } = this.deps.session.getSnapshot();
    this.switchUser(status === 'authenticated' && me ? me.user.id : null);
  };

  private switchUser(userId: string | null): void {
    if (userId === this.userId) return;
    this.gen++;
    for (const off of this.offSocket) off();
    this.offSocket = [];
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending = [];
    this.ids.clear();
    this.userId = userId;
    this.set(initial);
    if (!userId) return;
    const { socket } = this.deps;
    this.offSocket.push(
      socket.onEvent('notification', (n) => this.receive(n)),
      socket.onSync(({ reconnect }) => {
        if (reconnect) void this.resync();
      }),
    );
    void this.reload();
  }

  private set(patch: Partial<NotificationState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

export const notificationStore = new NotificationStore({
  session: sessionStore,
  socket: eventsSocket,
  api: httpNotificationsApi,
});
