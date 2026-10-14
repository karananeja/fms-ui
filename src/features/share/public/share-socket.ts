import type { RedactedCombinfo } from '@shared/contract/payloads.ts';
import type { ClientMessage, ServerMessage } from '@shared/contract/ws.ts';
import { WS_CLOSE, WS_PATH } from '@shared/contract/ws-protocol.ts';

/** The subset of the browser `WebSocket` the share socket uses. */
export interface ShareSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

/**
 * `connecting` / `live` / `reconnecting` while the link works; `gone` (4410: expired or revoked)
 * and `not-found` (4401: unknown token) are final; `error` (4403) is final too.
 */
export type ShareConnection =
  'connecting' | 'live' | 'reconnecting' | 'gone' | 'not-found' | 'error';

export interface ShareSocketState {
  connection: ShareConnection;
  /** The newest `combinfo` by `gpstime` (older payloads are ignored). */
  latest: RedactedCombinfo | null;
  /** Server clock minus local clock, from heartbeats (0 until the first one). */
  serverOffsetMs: number;
}

export interface ShareSocketOptions {
  token: string;
  vehicleId: string;
  /** Defaults to a browser `WebSocket` on `/ws/live?share=<token>` of this origin. */
  createSocket?: (url: string) => ShareSocketLike;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  random?: () => number;
  /** No message (heartbeats come every 15 s) for this long → drop and reconnect. */
  silenceTimeoutMs?: number;
}

const SUB_ID = 'share';
const FINAL: Record<number, ShareConnection> = {
  [WS_CLOSE.gone]: 'gone',
  [WS_CLOSE.unauthenticated]: 'not-found',
  [WS_CLOSE.forbidden]: 'error',
};

export const shareSocketUrl = (
  token: string,
  loc: Pick<Location, 'protocol' | 'host'> = location,
) =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${WS_PATH}?share=${encodeURIComponent(token)}`;

/**
 * F10-R9: one vehicle's live feed for the public page, on the main thread (no worker, D-089).
 * Subscribes to `combinfo` for the link's vehicle only; `lafparsed` is never requested (no
 * public metric uses it). Keeps the newest payload, reconnects with full-jitter backoff on
 * network drops, and stops for good on 4410 / 4401 / 4403.
 */
export class ShareSocket {
  private state: ShareSocketState = { connection: 'connecting', latest: null, serverOffsetMs: 0 };
  private readonly listeners = new Set<() => void>();
  private socket: ShareSocketLike | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private readonly o: Required<ShareSocketOptions>;

  constructor(options: ShareSocketOptions) {
    this.o = {
      createSocket: (url) => new WebSocket(url) as unknown as ShareSocketLike,
      backoffBaseMs: 1000,
      backoffMaxMs: 15_000,
      random: Math.random,
      silenceTimeoutMs: 40_000,
      ...options,
    };
  }

  getSnapshot = (): ShareSocketState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  start(): void {
    if (this.stopped || this.socket) return;
    this.open();
  }

  /** Stops for good (page unmount, or the link expired locally). */
  dispose(): void {
    this.stopped = true;
    this.clearTimers();
    this.drop();
  }

  private open(): void {
    this.retry = null;
    const socket = this.o.createSocket(shareSocketUrl(this.o.token));
    this.socket = socket;
    this.armSilence();
    socket.onopen = () => {
      const sub: ClientMessage = {
        type: 'subscribe',
        id: SUB_ID,
        topic: 'combinfo',
        scope: { kind: 'vehicle', vehicleId: this.o.vehicleId },
      };
      socket.send(JSON.stringify(sub));
    };
    socket.onmessage = (ev) => this.receive(ev.data);
    socket.onclose = (ev) => this.closed(ev.code);
    socket.onerror = () => {};
  }

  private receive(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    this.armSilence();
    if (msg.type === 'heartbeat') {
      this.set({ serverOffsetMs: msg.ts - Date.now() });
    } else if (msg.type === 'subscribed' && msg.id === SUB_ID) {
      this.set({ connection: 'live' });
    } else if (msg.type === 'payload' && msg.id === SUB_ID && msg.topic === 'combinfo') {
      const next = msg.data as RedactedCombinfo;
      this.attempt = 0;
      const prev = this.state.latest;
      if (prev && next.gpstime < prev.gpstime) return;
      this.set({ latest: next, connection: 'live' });
    }
  }

  private closed(code: number): void {
    this.socket = null;
    this.clearTimers();
    const final = FINAL[code];
    if (final) {
      this.stopped = true;
      this.set({ connection: final });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.set({ connection: 'reconnecting' });
    const { backoffBaseMs, backoffMaxMs, random } = this.o;
    const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** this.attempt++) * random();
    this.retry = setTimeout(() => this.open(), delay);
  }

  private armSilence(): void {
    if (this.silence) clearTimeout(this.silence);
    this.silence = setTimeout(() => {
      this.drop();
      this.scheduleReconnect();
    }, this.o.silenceTimeoutMs);
  }

  private clearTimers(): void {
    if (this.retry) clearTimeout(this.retry);
    if (this.silence) clearTimeout(this.silence);
    this.retry = this.silence = null;
  }

  /** Detaches and closes the current socket without running its close handler. */
  private drop(): void {
    const s = this.socket;
    if (!s) return;
    this.socket = null;
    s.onopen = s.onmessage = s.onerror = null;
    s.onclose = null;
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }

  private set(patch: Partial<ShareSocketState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
}
