import type { EventKind, EventMessage, Me, Scope, ServerMessage } from '@shared/contract/index.ts';
import { HEARTBEAT_MS, WS_PATH } from '@shared/contract/ws-protocol.ts';
import {
  systemClock,
  WsClient,
  type Clock,
  type SocketFactory,
  type SocketLike,
} from '@/features/live-tracking/worker/ws-client';
import type { ConnectionState } from '@/features/live-tracking/worker/worker-api';
import { sessionStore, type SessionState } from '@/features/auth/session/session-store';

/** The `data` of an `events` message of kind `K` (a `Notification`, `DriverRequest` or `Assignment`). */
export type EventData<K extends EventKind> = Extract<EventMessage, { kind: K }>['data'];
export type EventHandler<K extends EventKind> = (data: EventData<K>) => void;
/** After every `subscribed`: `reconnect` is false for the session's first one. */
export type SyncHandler = (info: { reconnect: boolean }) => void;

/** What the socket needs from the session store (F02 `SessionStore` matches it). */
export interface SessionSource {
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
  expire(): void;
}

export interface EventsSocketDeps {
  session: SessionSource;
  url: string;
  createSocket: SocketFactory;
  clock?: Clock;
  random?: () => number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

/** Staff permissions the server accepts for a fleet-scoped `events` subscribe (F11 D-093). */
const EVENT_STAFF = ['live.view', 'requests.manage', 'drivers.manage'] as const;
const SUB_ID = 'events';

/** The `events` scope for this user: staff → their fleets; a linked driver → `self`; else none. */
export function eventsScope(me: Me | null): Scope | null {
  if (!me) return null;
  if (EVENT_STAFF.some((p) => me.permissions.includes(p)) && me.fleetIds.length)
    return { kind: 'fleet', fleetIds: me.fleetIds };
  if (me.permissions.includes('driver.self')) return { kind: 'self' };
  return null;
}

/**
 * F15-R3 / D-097: the one main-thread client for the WS `events` topic (notifications, requests,
 * assignments), shared by F12–F15. Low volume, so it never touches the fleet worker (D-005).
 *
 * - **One socket per signed-in session**, opened lazily: only while at least one handler is
 *   registered and the session is authenticated with an `events` scope (`eventsScope`). It
 *   closes on sign-out/expiry and reopens with the new scope when the user changes.
 * - **Reconnects** with full-jitter backoff (F04 `WsClient`), re-subscribes, then calls every
 *   `onSync` handler with `{ reconnect: true }` so stores re-sync over REST (events sent while
 *   offline are not replayed).
 * - A close with 4401 expires the session (F02-R3).
 *
 * Usage (in a store, not per component):
 * ```ts
 * const off = eventsSocket.onEvent('assignment', (a) => …);   // typed `Assignment`
 * const offSync = eventsSocket.onSync(({ reconnect }) => { if (reconnect) void refetch(); });
 * ```
 */
export class EventsSocket {
  private readonly handlers = new Map<EventKind, Set<(data: unknown) => void>>();
  private readonly syncHandlers = new Set<SyncHandler>();
  private readonly stateListeners = new Set<() => void>();
  private client: WsClient | null = null;
  private userId: string | null = null;
  private synced = false;
  private offSession: (() => void) | null = null;
  private state: ConnectionState = 'offline';
  private offsetMs = 0;

  constructor(private readonly deps: EventsSocketDeps) {}

  /** Calls `handler` for every `events` message of `kind`; returns the unsubscribe. */
  onEvent<K extends EventKind>(kind: K, handler: EventHandler<K>): () => void {
    let set = this.handlers.get(kind);
    if (!set) this.handlers.set(kind, (set = new Set()));
    const h = handler as (data: unknown) => void;
    set.add(h);
    this.update();
    return () => {
      set.delete(h);
      this.update();
    };
  }

  /** Calls `handler` after each (re)subscribe; on `reconnect`, re-fetch what may have been missed. */
  onSync(handler: SyncHandler): () => void {
    this.syncHandlers.add(handler);
    this.update();
    return () => {
      this.syncHandlers.delete(handler);
      this.update();
    };
  }

  getState = (): ConnectionState => this.state;

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /** Server-clock corrected time (heartbeat offset; the mock clock may be shifted, D-038). */
  now(): number {
    return (this.deps.clock ?? systemClock).now() + this.offsetMs;
  }

  /** Closes the socket and drops every handler (tests, HMR). */
  dispose(): void {
    this.handlers.clear();
    this.syncHandlers.clear();
    this.update();
  }

  private get listenerCount(): number {
    let n = this.syncHandlers.size;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  /** Opens, keeps or closes the socket for the current session and listeners. */
  private update = (): void => {
    const wanted = this.listenerCount > 0;
    if (wanted && !this.offSession) this.offSession = this.deps.session.subscribe(this.update);
    if (!wanted && this.offSession) {
      this.offSession();
      this.offSession = null;
    }
    const { status, me } = this.deps.session.getSnapshot();
    const scope = wanted && status === 'authenticated' ? eventsScope(me) : null;
    const userId = scope ? me!.user.id : null;
    if (userId === this.userId) return;
    this.close();
    this.userId = userId;
    if (scope) this.open(scope);
  };

  private open(scope: Scope): void {
    const { clock = systemClock } = this.deps;
    this.synced = false;
    const client: WsClient = new WsClient({
      url: this.deps.url,
      createSocket: this.deps.createSocket,
      clock,
      random: this.deps.random ?? Math.random,
      backoffBaseMs: this.deps.backoffBaseMs ?? 500,
      backoffMaxMs: this.deps.backoffMaxMs ?? 30_000,
      heartbeatTimeoutMs: 2 * HEARTBEAT_MS,
      onOpen: () => client.send({ type: 'subscribe', id: SUB_ID, topic: 'events', scope }),
      onMessage: (msg) => this.receive(client, msg),
      onState: (state) => {
        this.setState(state);
        if (state === 'unauthenticated') this.deps.session.expire();
      },
    });
    this.client = client;
    client.connect();
  }

  private close(): void {
    this.client?.dispose();
    this.client = null;
    this.setState('offline');
  }

  private receive(client: WsClient, msg: ServerMessage): void {
    if (client !== this.client) return;
    if (msg.type === 'heartbeat') {
      this.offsetMs = client.serverOffsetMs;
    } else if (msg.type === 'subscribed') {
      client.resetBackoff();
      const reconnect = this.synced;
      this.synced = true;
      for (const h of [...this.syncHandlers]) h({ reconnect });
    } else if (msg.type === 'event') {
      for (const h of [...(this.handlers.get(msg.kind) ?? [])]) h(msg.data);
    }
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.stateListeners) l();
  }
}

/** The app's single `events` socket (same origin; Vite proxies `/ws` in dev). */
export const eventsSocket = new EventsSocket({
  session: sessionStore,
  url: `${globalThis.location?.origin.replace(/^http/, 'ws') ?? 'ws://localhost'}${WS_PATH}`,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
});
