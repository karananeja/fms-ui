import type { DashboardLiveEvent, ServerMessage } from '@shared/contract/ws.ts';
import { HEARTBEAT_MS, WS_PATH } from '@shared/contract/ws-protocol.ts';
import { sessionStore } from '@/features/auth/session/session-store';
import {
  systemClock,
  WsClient,
  type Clock,
  type SocketFactory,
  type SocketLike,
} from '@/features/live-tracking/worker/ws-client';

/** A pushed event, or `sync` after a reconnect (events sent while offline are not replayed). */
export type DashboardSocketEvent = DashboardLiveEvent | { kind: 'sync'; dashboardId: string };
export type DashboardSocketHandler = (e: DashboardSocketEvent) => void;

export interface DashboardSocketDeps {
  url: string;
  createSocket: SocketFactory;
  clock?: Clock;
  random?: () => number;
  /** A 4401 close (session gone). */
  onUnauthenticated?: () => void;
}

const subId = (dashboardId: string) => `dash:${dashboardId}`;

/**
 * F27 (D-153): the main-thread client for the WS `dashboard` topic. Low volume (a few events
 * per edit), so it stays off the fleet worker (D-005). One socket while at least one dashboard is
 * watched; re-subscribes on reconnect and then sends `{ kind: 'sync' }` so the page re-reads.
 */
export class DashboardSocket {
  private readonly watchers = new Map<string, Set<DashboardSocketHandler>>();
  private readonly synced = new Set<string>();
  private client: WsClient | null = null;

  constructor(private readonly deps: DashboardSocketDeps) {}

  /** Calls `handler` for every event of `dashboardId`; returns the unsubscribe. */
  watch(dashboardId: string, handler: DashboardSocketHandler): () => void {
    let set = this.watchers.get(dashboardId);
    const first = !set;
    if (!set) this.watchers.set(dashboardId, (set = new Set()));
    set.add(handler);
    if (!this.client) this.open();
    else if (first) this.subscribe(dashboardId);
    return () => {
      set.delete(handler);
      if (set.size) return;
      this.watchers.delete(dashboardId);
      this.synced.delete(dashboardId);
      this.client?.send({ type: 'unsubscribe', id: subId(dashboardId) });
      if (!this.watchers.size) this.close();
    };
  }

  dispose(): void {
    this.watchers.clear();
    this.close();
  }

  private subscribe(dashboardId: string): void {
    this.client?.send({
      type: 'subscribe',
      id: subId(dashboardId),
      topic: 'dashboard',
      scope: { kind: 'dashboard', dashboardId },
    });
  }

  private open(): void {
    const client: WsClient = new WsClient({
      url: this.deps.url,
      createSocket: this.deps.createSocket,
      clock: this.deps.clock ?? systemClock,
      random: this.deps.random ?? Math.random,
      backoffBaseMs: 500,
      backoffMaxMs: 30_000,
      heartbeatTimeoutMs: 2 * HEARTBEAT_MS,
      onOpen: () => {
        for (const id of this.watchers.keys()) this.subscribe(id);
      },
      onMessage: (msg) => this.receive(client, msg),
      onState: (state) => {
        if (state === 'unauthenticated') this.deps.onUnauthenticated?.();
      },
    });
    this.client = client;
    client.connect();
  }

  private close(): void {
    this.client?.dispose();
    this.client = null;
    this.synced.clear();
  }

  private emit(dashboardId: string, e: DashboardSocketEvent): void {
    for (const h of [...(this.watchers.get(dashboardId) ?? [])]) h(e);
  }

  private receive(client: WsClient, msg: ServerMessage): void {
    if (client !== this.client) return;
    if (msg.type === 'subscribed' && msg.id.startsWith('dash:')) {
      client.resetBackoff();
      const id = msg.id.slice(5);
      if (this.synced.has(id)) this.emit(id, { kind: 'sync', dashboardId: id });
      this.synced.add(id);
    } else if (msg.type === 'dashboard') {
      this.emit(msg.event.dashboardId, msg.event);
    }
  }
}

/** The app's dashboard socket (same origin; Vite proxies `/ws` in dev). */
export const dashboardSocket = new DashboardSocket({
  url: `${globalThis.location?.origin.replace(/^http/, 'ws') ?? 'ws://localhost'}${WS_PATH}`,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  onUnauthenticated: () => sessionStore.expire(),
});
