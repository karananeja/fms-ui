import type { ClientMessage, ServerMessage } from '@shared/contract/index.ts';
import { WS_CLOSE } from '@shared/contract/ws-protocol.ts';
import type { ConnectionState } from './worker-api.ts';

/** The subset of the browser `WebSocket` the client uses (the `ws` package matches it too). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: (() => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Full-jitter exponential backoff. */
export const backoffDelay = (attempt: number, baseMs: number, maxMs: number, random: number) =>
  Math.min(maxMs, baseMs * 2 ** attempt) * random;

export interface WsClientOptions {
  url: string;
  createSocket: SocketFactory;
  clock: Clock;
  random: () => number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  heartbeatTimeoutMs: number;
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onState(state: ConnectionState): void;
}

const isOffline = () =>
  (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine === false;

/** One logical connection: reconnects with backoff, watches heartbeats, tracks server clock. */
export class WsClient {
  state: ConnectionState = 'offline';
  serverOffsetMs = 0;
  reconnects = 0;
  lastMessageAt = 0;
  private attempt = 0;
  private socket: SocketLike | null = null;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;
  private disposed = false;

  constructor(private readonly o: WsClientOptions) {}

  connect(): void {
    if (this.disposed) return;
    this.retryTimer = null;
    this.setState(this.reconnects > 0 ? 'reconnecting' : 'connecting');
    const socket = this.o.createSocket(this.o.url);
    this.socket = socket;
    this.armWatchdog();
    socket.onopen = () => {
      this.setState('live');
      this.o.onOpen();
    };
    socket.onmessage = (ev) => this.receive(ev.data);
    socket.onclose = (ev) => this.closed(ev.code);
    socket.onerror = () => {};
  }

  /** Sends only while open; subscriptions are re-sent on every (re)connect. */
  send(msg: ClientMessage): void {
    if (this.state === 'live') this.socket?.send(JSON.stringify(msg));
  }

  /** Called once a snapshot completes: the next failure starts the backoff from scratch. */
  resetBackoff(): void {
    this.attempt = 0;
  }

  /** Server-clock corrected time. */
  now(): number {
    return this.o.clock.now() + this.serverOffsetMs;
  }

  dispose(): void {
    this.disposed = true;
    this.o.clock.clearTimeout(this.retryTimer);
    this.drop();
    this.setState('offline');
  }

  private receive(data: unknown): void {
    this.lastMessageAt = this.o.clock.now();
    this.armWatchdog();
    const msg = JSON.parse(String(data)) as ServerMessage;
    if (msg.type === 'heartbeat') this.serverOffsetMs = msg.ts - this.o.clock.now();
    this.o.onMessage(msg);
  }

  private closed(code: number): void {
    this.drop();
    if (code === WS_CLOSE.unauthenticated) this.setState('unauthenticated');
    else if (code === WS_CLOSE.forbidden) this.setState('error');
    else this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState(isOffline() ? 'offline' : 'reconnecting');
    const { backoffBaseMs, backoffMaxMs } = this.o;
    const delay = backoffDelay(this.attempt++, backoffBaseMs, backoffMaxMs, this.o.random());
    this.retryTimer = this.o.clock.setTimeout(() => {
      this.reconnects++;
      this.connect();
    }, delay);
  }

  private armWatchdog(): void {
    this.o.clock.clearTimeout(this.watchdog);
    this.watchdog = this.o.clock.setTimeout(() => {
      this.drop();
      this.scheduleReconnect();
    }, this.o.heartbeatTimeoutMs);
  }

  /** Detaches and closes the current socket without triggering its close handler. */
  private drop(): void {
    this.o.clock.clearTimeout(this.watchdog);
    this.watchdog = null;
    const s = this.socket;
    if (!s) return;
    this.socket = null;
    s.onopen = s.onmessage = s.onclose = null;
    s.onerror = () => {};
    try {
      s.close();
    } catch {
      // already closed
    }
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.o.onState(state);
  }
}
