import {
  clientMessageSchema,
  COMBINFO_DELTA_FIELDS,
  COMBINFO_LEAVE_FIELDS,
  COMBINFO_SNAPSHOT_FIELDS,
  HEARTBEAT_MS,
  LAFPARSED_BASE_FIELDS,
  WS_CLOSE,
  type ServerMessage,
  type SubscribeMessage,
  type Topic,
} from '@shared/contract/index.ts';
import type { WebSocket } from 'ws';
import type { MockContext } from '../context.ts';
import { PID_SET } from '../generator/vehicle-sim.ts';
import type { ShareLinkRecord } from '../store/share-links.ts';
import { redactCombinfo, redactLafparsed } from './redact.ts';

type Principal = { kind: 'user'; userId: string } | { kind: 'share'; link: ShareLinkRecord };

interface Conn {
  ws: WebSocket;
  principal: Principal;
  subs: Map<string, Sub>;
}

interface Sub {
  id: string;
  conn: Conn;
  topic: Topic;
  /** Data up to this mock time has been sent. */
  since: number;
  ready: boolean;
  closed: boolean;
  seq: number;
  fleetIds?: string[];
  mask?: Uint8Array;
  maskVersion?: number;
  pids?: string[];
  vehicle?: number;
}

const OPEN = 1;

/** Owns live sockets and subscriptions; flushes batched deltas every `MOCK_BATCH_MS`. */
export class LiveHub {
  private readonly conns = new Set<Conn>();
  private readonly moved = new Map<number, number>();
  private lastFlush: number;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly ctx: MockContext) {
    this.lastFlush = ctx.clock.now();
  }

  start(): void {
    this.timers.push(setInterval(() => this.flush(), this.ctx.config.batchMs));
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.conns) c.ws.terminate();
    this.conns.clear();
  }

  get socketCount(): number {
    return this.conns.size;
  }

  get subscriptionCount(): number {
    let n = 0;
    for (const c of this.conns) n += c.subs.size;
    return n;
  }

  // ---- connections ----

  accept(ws: WebSocket, principal: Principal | { close: number; reason: string }): void {
    if ('close' in principal) {
      ws.close(principal.close, principal.reason);
      return;
    }
    const conn: Conn = { ws, principal, subs: new Map() };
    this.conns.add(conn);
    ws.on('message', (raw) => this.onMessage(conn, raw.toString()));
    ws.on('close', () => this.drop(conn));
    ws.on('error', () => this.drop(conn));
  }

  private drop(conn: Conn): void {
    for (const s of conn.subs.values()) s.closed = true;
    this.conns.delete(conn);
  }

  private close(conn: Conn, code: number, reason: string): void {
    this.drop(conn);
    if (conn.ws.readyState === OPEN) conn.ws.close(code, reason);
  }

  /** Closes every public socket of a revoked share link with `4410`. */
  closeShare(linkId: string): void {
    for (const c of this.conns) {
      if (c.principal.kind === 'share' && c.principal.link.id === linkId) {
        this.close(c, WS_CLOSE.gone, 'share link revoked');
      }
    }
  }

  vehicleMoved(i: number, fromFleet: number): void {
    if (!this.moved.has(i)) this.moved.set(i, fromFleet);
  }

  private send(conn: Conn, msg: ServerMessage): Promise<void> {
    if (conn.ws.readyState !== OPEN) return Promise.resolve();
    return new Promise((resolve) => conn.ws.send(JSON.stringify(msg), () => resolve()));
  }

  private error(conn: Conn, code: string, message: string, id?: string): void {
    void this.send(conn, { type: 'error', ...(id === undefined ? {} : { id }), code, message });
  }

  // ---- client messages ----

  private onMessage(conn: Conn, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.error(conn, 'bad_request', 'Message is not valid JSON');
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) {
      return this.error(
        conn,
        'validation_failed',
        parsed.error.issues[0]?.message ?? 'Invalid message',
      );
    }
    const msg = parsed.data;
    if (msg.type === 'ping') void this.send(conn, { type: 'pong' });
    else if (msg.type === 'unsubscribe') {
      const sub = conn.subs.get(msg.id);
      if (sub) sub.closed = true;
      conn.subs.delete(msg.id);
    } else this.subscribe(conn, msg);
  }

  private subscribe(conn: Conn, msg: SubscribeMessage): void {
    const { tree, sim, accounts, clock } = this.ctx;
    if (conn.subs.has(msg.id))
      return this.error(conn, 'conflict', 'Subscription id already in use', msg.id);
    const forbidden = (reason: string) => this.close(conn, WS_CLOSE.forbidden, reason);
    const now = clock.now();
    const sub: Sub = {
      id: msg.id,
      conn,
      topic: msg.topic,
      since: now,
      ready: false,
      closed: false,
      seq: 0,
    };

    if (conn.principal.kind === 'share') {
      const { link } = conn.principal;
      if (msg.scope.kind !== 'vehicle' || msg.scope.vehicleId !== link.vehicleId) {
        return forbidden('share links may only subscribe to their own vehicle');
      }
      if (msg.topic === 'lafparsed' && !link.show.drivingEnergy) {
        return this.error(conn, 'forbidden', 'lafparsed is hidden by this share link', msg.id);
      }
      sub.vehicle = sim.indexOf(link.vehicleId);
    } else {
      const user = accounts.users.get(conn.principal.userId);
      if (!user || user.status !== 'active')
        return this.close(conn, WS_CLOSE.unauthenticated, 'session ended');
      if (!accounts.permissions(user).includes('live.view')) return forbidden('requires live.view');
      if (msg.scope.kind === 'vehicle') {
        const i = sim.indexOf(msg.scope.vehicleId);
        if (i < 0 || !tree.inScope(sim.fleetId(i), user.fleetIds))
          return forbidden('vehicle outside your scope');
        sub.vehicle = i;
      } else {
        if (!msg.scope.fleetIds.every((id) => tree.inScope(id, user.fleetIds))) {
          return forbidden('fleet outside your scope');
        }
        sub.fleetIds = msg.scope.fleetIds;
        if (msg.topic === 'lafparsed') {
          const unknown = msg.pids?.find((p) => !PID_SET.has(p));
          if (unknown)
            return this.error(conn, 'validation_failed', `Unknown PID ${unknown}`, msg.id);
          sub.pids = msg.pids ?? [];
        }
      }
    }

    conn.subs.set(sub.id, sub);
    void this.send(conn, { type: 'subscribed', id: sub.id });
    if (sub.vehicle !== undefined) {
      this.sendPayload(sub, now);
      sub.ready = true;
    } else void this.snapshot(sub, now);
  }

  // ---- data ----

  private maskOf(sub: Sub): Uint8Array {
    const { tree } = this.ctx;
    if (!sub.mask || sub.maskVersion !== tree.version) {
      sub.mask = tree.scopeMask(sub.fleetIds!);
      sub.maskVersion = tree.version;
    }
    return sub.mask;
  }

  private fieldsOf(sub: Sub): string[] {
    return sub.topic === 'lafparsed'
      ? [...LAFPARSED_BASE_FIELDS, ...sub.pids!]
      : COMBINFO_DELTA_FIELDS;
  }

  private row(sub: Sub, i: number, t: number, cache: Map<number, unknown[]>): unknown[] {
    const { sim } = this.ctx;
    if (sub.topic === 'lafparsed') return sim.lafRow(i, t, sub.pids!);
    let row = cache.get(i);
    if (!row) cache.set(i, (row = [sim.vehicleId(i), ...sim.liveRow(i, t)]));
    return row;
  }

  private async snapshot(sub: Sub, t: number): Promise<void> {
    const { sim, config } = this.ctx;
    const mask = this.maskOf(sub);
    const members: number[] = [];
    for (let i = 0; i < sim.count; i++) if (mask[sim.fleet[i]!]) members.push(i);
    const size = config.snapshotChunk;
    const chunks = Math.max(1, Math.ceil(members.length / size));
    const fields = sub.topic === 'lafparsed' ? this.fieldsOf(sub) : COMBINFO_SNAPSHOT_FIELDS;
    for (let chunk = 0; chunk < chunks; chunk++) {
      if (sub.closed) return;
      const rows = members
        .slice(chunk * size, (chunk + 1) * size)
        .map((i) =>
          sub.topic === 'lafparsed' ? sim.lafRow(i, t, sub.pids!) : sim.snapshotRow(i, t),
        );
      await this.send(sub.conn, {
        type: 'snapshot',
        id: sub.id,
        seq: ++sub.seq,
        chunk,
        chunks,
        fields,
        rows,
      });
    }
    sub.since = t;
    sub.ready = true;
  }

  private sendPayload(sub: Sub, t: number): void {
    const { sim } = this.ctx;
    const i = sub.vehicle!;
    const { principal } = sub.conn;
    const show = principal.kind === 'share' ? principal.link.show : undefined;
    const data =
      sub.topic === 'combinfo'
        ? redactCombinfo(sim.combinfo(i, t), show)
        : redactLafparsed(sim.lafparsed(i, t), show);
    void this.send(sub.conn, { type: 'payload', id: sub.id, topic: sub.topic, data });
  }

  private sendRows(sub: Sub, fields: string[], rows: unknown[][]): void {
    const size = this.ctx.config.snapshotChunk;
    for (let k = 0; k < rows.length; k += size) {
      void this.send(sub.conn, {
        type: 'delta',
        id: sub.id,
        seq: ++sub.seq,
        fields,
        rows: rows.slice(k, k + size),
      });
    }
  }

  flush(): void {
    const { sim, clock, shares } = this.ctx;
    const now = clock.now();
    const prev = this.lastFlush <= now ? this.lastFlush : now - this.ctx.config.batchMs;
    this.lastFlush = now;
    const moved = new Map(this.moved);
    this.moved.clear();

    const fleetSubs: Sub[] = [];
    for (const conn of this.conns) {
      if (conn.principal.kind === 'share' && !shares.isLive(conn.principal.link)) {
        this.close(conn, WS_CLOSE.gone, 'share link expired');
        continue;
      }
      for (const sub of conn.subs.values()) {
        if (!sub.ready) continue;
        if (sub.since > now) sub.since = prev;
        if (sub.vehicle === undefined) fleetSubs.push(sub);
        else if (sim.reportAt(sub.vehicle, now) > sub.since) {
          this.sendPayload(sub, now);
          sub.since = now;
        }
      }
    }
    if (!fleetSubs.length) return;

    const reportedSince = new Map<number, number[]>();
    const reported = (since: number) => {
      let list = reportedSince.get(since);
      if (!list) {
        list = [];
        for (let i = 0; i < sim.count; i++) if (sim.reportAt(i, now) > since) list.push(i);
        reportedSince.set(since, list);
      }
      return list;
    };
    const cache = new Map<number, unknown[]>();

    for (const sub of fleetSubs) {
      const mask = this.maskOf(sub);
      const rows: unknown[][] = [];
      const enter: unknown[][] = [];
      const leave: unknown[][] = [];
      for (const [i, from] of moved) {
        const inNow = mask[sim.fleet[i]!] === 1;
        const wasIn = mask[from] === 1;
        if (sub.topic === 'lafparsed') {
          if (inNow && !wasIn) rows.push(sim.lafRow(i, now, sub.pids!));
        } else if (inNow) enter.push(sim.snapshotRow(i, now));
        else if (wasIn) leave.push([sim.vehicleId(i), null]);
      }
      for (const i of reported(sub.since)) {
        if (mask[sim.fleet[i]!] && !(sub.topic === 'combinfo' && moved.has(i)))
          rows.push(this.row(sub, i, now, cache));
      }
      if (enter.length) this.sendRows(sub, COMBINFO_SNAPSHOT_FIELDS, enter);
      if (leave.length) this.sendRows(sub, COMBINFO_LEAVE_FIELDS, leave);
      if (rows.length) this.sendRows(sub, this.fieldsOf(sub), rows);
      sub.since = now;
    }
  }

  private heartbeat(): void {
    const ts = this.ctx.clock.now();
    for (const c of this.conns) void this.send(c, { type: 'heartbeat', ts });
  }
}
