import type { Combinfo, Lafparsed, Me, ServerMessage } from '@shared/contract/index.ts';
import { liveTrackingConfig, type LiveTrackingConfig } from '../config/live-tracking-config.ts';
import { FleetState } from './fleet-state.ts';
import type {
  ConnectionState,
  LivePush,
  LiveStats,
  LiveTrackingWorkerApi,
  SelectedVehicle,
  VehicleSummary,
} from './worker-api.ts';
import { systemClock, WsClient, type Clock, type SocketFactory } from './ws-client.ts';

export const SUB_FLEET_COMBINFO = 'fleet-combinfo';
export const SUB_FLEET_LAFPARSED = 'fleet-lafparsed';

export interface EngineDeps {
  url: string;
  createSocket: SocketFactory;
  clock?: Clock;
  random?: () => number;
  config?: Partial<LiveTrackingConfig>;
  /** Called after `dispose()` (the worker entry closes itself here). */
  onDispose?: () => void;
}

interface Selection {
  vehicleId: string;
  found: boolean;
  gen: number;
  combinfo: Combinfo | null;
  lafparsed: Lafparsed | null;
}

/** Orchestrates socket, fleet state, subscriptions and coalesced pushes. No `self`: runs in Node. */
export class LiveTrackingEngine implements LiveTrackingWorkerApi {
  readonly config: LiveTrackingConfig;
  readonly state: FleetState;
  readonly client: WsClient;
  pushCount = 0;
  private readonly clock: Clock;
  private me: Me | null = null;
  private onPush: ((push: LivePush) => void) | null = null;
  private snapshotComplete = false;
  private selection: Selection | null = null;
  private selectionGen = 0;
  private selectionDirty = false;
  private dirty = false;
  private lastPushAt = -Infinity;
  private pushTimer: unknown = null;
  private statsTimer: unknown = null;
  private pendingTimer: unknown = null;
  private rows = 0;
  private msgs = 0;
  private rowsPerSec = 0;
  private msgsPerSec = 0;

  constructor(private readonly deps: EngineDeps) {
    this.config = { ...liveTrackingConfig, ...deps.config };
    this.clock = deps.clock ?? systemClock;
    this.state = new FleetState({
      pids: this.config.fleetLafPids,
      capacity: this.config.initialCapacity,
      pendingMax: this.config.pendingLafMax,
    });
    this.client = new WsClient({
      url: deps.url,
      createSocket: deps.createSocket,
      clock: this.clock,
      random: deps.random ?? Math.random,
      backoffBaseMs: this.config.backoffBaseMs,
      backoffMaxMs: this.config.backoffMaxMs,
      heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
      onOpen: () => this.subscribeAll(),
      onMessage: (msg) => this.receive(msg),
      onState: () => this.markDirty(),
    });
  }

  init(me: Me, onPush: (push: LivePush) => void): void {
    if (this.me) return;
    this.me = me;
    this.onPush = onPush;
    this.client.connect();
    this.tickStats();
  }

  /** Server-clock corrected time; all freshness logic uses this. */
  now(): number {
    return this.client.now();
  }

  selectVehicle(vehicleId: string | null): boolean {
    const current = this.selection;
    if ((current?.vehicleId ?? null) === vehicleId) return current?.found ?? true;
    if (current?.found) this.unsubscribeSelection(current);
    this.selection = null;
    if (vehicleId !== null) {
      const found = this.state.indexOf(vehicleId) >= 0;
      this.selection = { vehicleId, found, gen: 0, combinfo: null, lafparsed: null };
      if (found) this.subscribeSelection();
    }
    this.selectionDirty = true;
    this.markDirty();
    return this.selection?.found ?? true;
  }

  getVehicleSummary(vehicleId: string): VehicleSummary | null {
    const i = this.state.indexOf(vehicleId);
    return i < 0 ? null : this.state.summary(i);
  }

  get connection(): ConnectionState {
    return this.client.state;
  }

  get stats(): LiveStats {
    return {
      vehicleCount: this.state.count,
      snapshotComplete: this.snapshotComplete,
      rowsPerSec: this.rowsPerSec,
      msgsPerSec: this.msgsPerSec,
      lastMessageAt: this.client.lastMessageAt,
      reconnects: this.client.reconnects,
      stateBytes: this.state.bytes,
      serverOffsetMs: this.client.serverOffsetMs,
    };
  }

  dispose(): void {
    for (const t of [this.pushTimer, this.statsTimer, this.pendingTimer])
      this.clock.clearTimeout(t);
    this.onPush = null;
    this.client.dispose();
    this.deps.onDispose?.();
  }

  // ---- subscriptions ----

  private subscribeAll(): void {
    const fleetIds = this.me?.fleetIds ?? [];
    this.state.openPending();
    this.clock.clearTimeout(this.pendingTimer);
    if (fleetIds.length) {
      const scope = { kind: 'fleet' as const, fleetIds };
      this.client.send({ type: 'subscribe', id: SUB_FLEET_COMBINFO, topic: 'combinfo', scope });
      this.client.send({
        type: 'subscribe',
        id: SUB_FLEET_LAFPARSED,
        topic: 'lafparsed',
        scope,
        pids: [...this.config.fleetLafPids],
      });
    } else {
      this.state.beginSnapshot();
      this.completeSnapshot();
    }
    if (this.selection?.found) this.subscribeSelection();
  }

  private subscribeSelection(): void {
    const s = this.selection!;
    s.gen = ++this.selectionGen;
    const scope = { kind: 'vehicle' as const, vehicleId: s.vehicleId };
    this.client.send({ type: 'subscribe', id: `sel-c-${s.gen}`, topic: 'combinfo', scope });
    this.client.send({ type: 'subscribe', id: `sel-l-${s.gen}`, topic: 'lafparsed', scope });
  }

  private unsubscribeSelection(s: Selection): void {
    this.client.send({ type: 'unsubscribe', id: `sel-c-${s.gen}` });
    this.client.send({ type: 'unsubscribe', id: `sel-l-${s.gen}` });
  }

  // ---- messages ----

  private receive(msg: ServerMessage): void {
    this.msgs++;
    switch (msg.type) {
      case 'snapshot':
      case 'delta': {
        this.rows += msg.rows.length;
        if (msg.id === SUB_FLEET_COMBINFO) {
          const first = msg.type === 'snapshot' && msg.chunk === 0;
          if (first) {
            this.snapshotComplete = false;
            this.state.beginSnapshot();
          }
          this.state.applyCombinfo(msg.fields, msg.rows);
          if (msg.type === 'snapshot' && msg.chunk === msg.chunks - 1) this.completeSnapshot();
        } else if (msg.id === SUB_FLEET_LAFPARSED) {
          this.state.applyLafparsed(msg.fields, msg.rows);
        }
        break;
      }
      case 'payload': {
        const s = this.selection;
        if (!s) break;
        if (msg.id === `sel-c-${s.gen}`) s.combinfo = msg.data as Combinfo;
        else if (msg.id === `sel-l-${s.gen}`) s.lafparsed = msg.data as Lafparsed;
        else break;
        this.selectionDirty = true;
        break;
      }
      case 'error':
        console.warn(`[live] ${msg.code}: ${msg.message}`);
        break;
    }
    this.markDirty();
  }

  private completeSnapshot(): void {
    this.state.endSnapshot();
    this.snapshotComplete = true;
    this.client.resetBackoff();
    this.pendingTimer = this.clock.setTimeout(
      () => this.state.closePending(),
      this.config.pendingLafTtlMs,
    );
  }

  // ---- push ----

  private markDirty(): void {
    this.dirty = true;
    if (this.pushTimer !== null || !this.onPush) return;
    const wait = Math.max(0, this.lastPushAt + 1000 / this.config.pushHz - this.clock.now());
    this.pushTimer = this.clock.setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.pushTimer = null;
    if (!this.dirty || !this.onPush) return;
    this.dirty = false;
    this.lastPushAt = this.clock.now();
    const push: LivePush = {
      connection: this.client.state,
      stats: this.stats,
      version: this.state.version,
    };
    if (this.selectionDirty) {
      this.selectionDirty = false;
      push.selected = this.selection && toSelected(this.selection);
    }
    this.pushCount++;
    this.onPush(push);
  }

  private tickStats(): void {
    const sec = this.config.statsIntervalMs / 1000;
    const rowsPerSec = Math.round(this.rows / sec);
    const msgsPerSec = Math.round(this.msgs / sec);
    this.rows = this.msgs = 0;
    if (rowsPerSec !== this.rowsPerSec || msgsPerSec !== this.msgsPerSec) {
      this.rowsPerSec = rowsPerSec;
      this.msgsPerSec = msgsPerSec;
      this.markDirty();
    }
    this.statsTimer = this.clock.setTimeout(() => this.tickStats(), this.config.statsIntervalMs);
  }
}

const toSelected = ({ vehicleId, found, combinfo, lafparsed }: Selection): SelectedVehicle => ({
  vehicleId,
  found,
  combinfo,
  lafparsed,
});
