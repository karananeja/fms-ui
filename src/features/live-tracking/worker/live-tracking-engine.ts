import type {
  Assignment,
  Combinfo,
  Lafparsed,
  Me,
  ServerMessage,
} from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { liveTrackingConfig, type LiveTrackingConfig } from '../config/live-tracking-config.ts';
import type { MapConfig } from '../config/map-config.ts';
import {
  statusLafPids,
  statusRulesConfig,
  type StatusRulesConfig,
} from '../config/status-rules-config.ts';
import { parseStatusRulesConfig } from '../config/status-rules-schema.ts';
import { FleetState } from './fleet-state.ts';
import {
  FilterEngine,
  type FleetNode,
  type SearchField,
  type VehicleFilter,
} from './filter-engine.ts';
import { exportCsv, type CsvRequest, type CsvResult } from './csv-exporter.ts';
import { DriverIndex, DriverSearch, type DriverIndexRow, type FetchJson } from './driver-index.ts';
import { frameBuffers, MapIndex } from './map-index.ts';
import { SearchIndex, type Suggestion } from './search-index.ts';
import { SelectedHistory } from './selected-history.ts';
import { detailsConfig } from '../config/details-config.ts';
import { StatusTracker } from './status-deriver.ts';
import { TableQueryEngine, type TableQuery, type TableResult } from './table-query.ts';
import { trayQuery, type TrayCard } from './tray-query.ts';
import type {
  Bbox,
  ConnectionState,
  FilterOptions,
  LivePush,
  LiveStats,
  LiveTrackingWorkerApi,
  MapFrame,
  MapViewport,
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
  /** Status rules (validated on construction); `fleetLafPids` is derived from them. */
  statusRules?: StatusRulesConfig;
  /** Called after `dispose()` (the worker entry closes itself here). */
  onDispose?: () => void;
  map?: Partial<MapConfig>;
  /** Marks buffers for transfer (Comlink `transfer` in the worker; identity elsewhere). */
  transfer?: <T>(value: T, buffers: ArrayBuffer[]) => T;
  /** F12: same-origin JSON GET with the session cookie (rejects on non-2xx). */
  fetchJson?: FetchJson;
}

/** Default `fetchJson`: the worker shares the page's origin and cookies. */
const defaultFetchJson: FetchJson = async (path) => {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

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
  readonly rules: StatusRulesConfig;
  readonly state: FleetState;
  readonly status: StatusTracker;
  readonly client: WsClient;
  /** F08/F09 contract: consumers call `filters.matches(i)` only. */
  readonly filters: FilterEngine;
  readonly search: SearchIndex;
  readonly map: MapIndex;
  /** F09: sorted windows over matching vehicles (table + CSV). */
  readonly table: TableQueryEngine;
  /** F12-R6: driver-name search (D-095). */
  readonly drivers: DriverSearch;
  private fleetNames: Record<string, string> = {};
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
  private sweepTimer: unknown = null;
  private sweepMs = 0;
  private rebuildTimer: unknown = null;
  /** The first complete snapshot must show at once, not after the rebuild throttle. */
  private rebuildNow = false;
  private viewport: MapViewport | null = null;
  /** Bumped when a sweep changed any status (the state version covers rows). */
  private statusEpoch = 0;
  private frameOf = { data: -1, generation: -1, filter: -1 };
  private selectedStatus: VehicleStatus | null = null;
  private readonly history = new SelectedHistory(detailsConfig.historyMs);
  private rows = 0;
  private msgs = 0;
  private rowsPerSec = 0;
  private msgsPerSec = 0;

  constructor(private readonly deps: EngineDeps) {
    this.rules = parseStatusRulesConfig(deps.statusRules ?? statusRulesConfig);
    this.config = {
      ...liveTrackingConfig,
      ...(deps.statusRules && { fleetLafPids: statusLafPids(this.rules) }),
      ...deps.config,
    };
    this.clock = deps.clock ?? systemClock;
    this.state = new FleetState({
      pids: this.config.fleetLafPids,
      capacity: this.config.initialCapacity,
      pendingMax: this.config.pendingLafMax,
    });
    this.status = new StatusTracker(this.state, this.rules);
    this.filters = new FilterEngine(this.state);
    this.search = new SearchIndex(this.state, (task) => this.clock.setTimeout(task, 0));
    this.map = new MapIndex(this.state, deps.map, this.filters);
    this.drivers = new DriverSearch(new DriverIndex(), deps.fetchJson ?? defaultFetchJson);
    this.table = new TableQueryEngine(
      this.state,
      (i) => this.filters.matches(i),
      () => this.state.version + this.statusEpoch + this.filters.version,
      () => this.clock.now(),
    );
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
    this.tickSweep();
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
    this.history.reset();
    this.selectedStatus = null;
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
    return i < 0 ? null : { ...this.state.summary(i), status: this.status.statusOf(i)! };
  }

  setViewport(viewport: MapViewport | null): MapFrame | null {
    this.viewport = viewport;
    if (!viewport) return null;
    const frame = this.computeFrame();
    return this.transfer(frame, frameBuffers(frame));
  }

  getClusterExpansionZoom(clusterId: number): number | null {
    return this.map.expansionZoom(clusterId);
  }

  getBounds(): Bbox | null {
    return this.map.bounds();
  }

  // ---- F09: table, CSV, tray ----

  setFleetNames(names: Record<string, string>): void {
    this.fleetNames = names;
    this.table.setFleetNames(names);
  }

  queryTable(query: TableQuery): TableResult {
    return this.table.query(query);
  }

  exportCsv(
    req: CsvRequest,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CsvResult> {
    return exportCsv(req, this.state, this.table, this.fleetNames, onProgress);
  }

  getTray(bbox: Bbox, limit?: number): TrayCard[] {
    return trayQuery(this.state, (i) => this.filters.matches(i), this.rules.priority, bbox, limit);
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
      sweepMs: this.sweepMs,
      clusterBuildMs: this.map.buildMs,
    };
  }

  dispose(): void {
    for (const t of [
      this.pushTimer,
      this.statsTimer,
      this.pendingTimer,
      this.sweepTimer,
      this.rebuildTimer,
    ])
      this.clock.clearTimeout(t);
    this.onPush = null;
    this.client.dispose();
    this.deps.onDispose?.();
  }

  // ---- F08: filters & search ----

  setFilter(filter: VehicleFilter): void {
    const base = this.filters.baseVersion;
    this.filters.set(filter);
    // D-072: only a change outside `statuses` needs the index rebuilt (or swapped) at once.
    if (this.filters.baseVersion !== base) this.rebuildNow = true;
    this.pushNow();
  }

  setFleets(fleets: FleetNode[]): void {
    this.filters.setFleets(fleets);
    this.rebuildNow = true;
    this.markDirty();
  }

  suggest(prefix: string, field: SearchField, limit = 8): Suggestion[] {
    return this.search.suggest(prefix, field, limit);
  }

  // ---- F12: driver search ----

  async suggestDriver(prefix: string, limit = 8): Promise<Suggestion[]> {
    if (!prefix.trim()) return [];
    const known = (id: string) => this.state.indexOf(id) >= 0;
    await this.drivers.fill(prefix, known);
    return this.drivers.index.match(prefix, limit, known).map((m) => ({
      ...this.search.suggestionAt(this.state.indexOf(m.vehicleId), 'driver'),
      driverName: m.name,
    }));
  }

  applyAssignment(a: Assignment): Promise<void> {
    return this.drivers.apply(a);
  }

  loadDriverIndex(rows: DriverIndexRow[]): void {
    this.drivers.index.load(rows);
    this.drivers.reset();
  }

  getFilterOptions(): FilterOptions {
    const { codes, dicts, count } = this.state;
    const distinct = (f: 'assetType' | 'fuelType' | 'make') => {
      const seen = new Uint8Array(dicts[f].values.length);
      for (let i = 0; i < count; i++) seen[codes[f][i]!] = 1;
      return dicts[f].values.filter((v, k) => seen[k] && v).sort();
    };
    const models = new Map<string, { make: string; model: string }>();
    for (let i = 0; i < count; i++) {
      const make = dicts.make.values[codes.make[i]!]!;
      const model = dicts.model.values[codes.model[i]!]!;
      if (model) models.set(`${make}\u0000${model}`, { make, model });
    }
    return {
      assetTypes: distinct('assetType'),
      fuelTypes: distinct('fuelType'),
      makes: distinct('make'),
      models: [...models.values()].sort((a, b) => a.model.localeCompare(b.model)),
    };
  }

  private filteredPush(): Pick<LivePush, 'filteredCounts' | 'filteredTotal' | 'selectedMatches'> {
    const { counts, total } = this.filters.active
      ? this.filters.counts()
      : { counts: this.status.statusCounts(), total: this.state.count };
    const s = this.selection;
    const i = s?.found ? this.state.indexOf(s.vehicleId) : -1;
    return {
      filteredCounts: counts,
      filteredTotal: total,
      selectedMatches: i < 0 || this.filters.matches(i),
    };
  }

  // ---- subscriptions ----

  private subscribeAll(): void {
    const fleetIds = this.me?.fleetIds ?? [];
    this.state.openPending();
    this.clock.clearTimeout(this.pendingTimer);
    if (fleetIds.length) {
      this.snapshotComplete = false;
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
        this.status.now = this.now();
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
        if (msg.id === `sel-c-${s.gen}`) {
          s.combinfo = msg.data as Combinfo;
          const i = this.state.indexOf(s.vehicleId);
          this.history.addPayload(s.combinfo, i < 0 ? null : this.status.statusOf(i));
        } else if (msg.id === `sel-l-${s.gen}`) s.lafparsed = msg.data as Lafparsed;
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
    this.rebuildNow = true;
    // After the first frame goes out: later searches then never wait for a full index build.
    this.clock.setTimeout(() => this.search.warm(), 0);
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

  /**
   * D-073: a user filter change pushes at once instead of waiting for the next 4 Hz slot; the
   * push restarts the 250 ms window, so data-driven pushes stay coalesced after it.
   */
  private pushNow(): void {
    if (this.pushTimer !== null) {
      this.clock.clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.dirty = true;
    this.flush();
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
      statusCounts: this.status.statusCounts(),
      total: this.state.count,
      ...this.filteredPush(),
    };
    const s = this.selection;
    const i = s?.found ? this.state.indexOf(s.vehicleId) : -1;
    const status = i < 0 ? null : this.status.statusOf(i);
    if (this.selectionDirty || status !== this.selectedStatus) {
      this.selectionDirty = false;
      this.selectedStatus = status;
      this.history.observeStatus(status, this.now());
      push.selected = s && { ...toSelected(s, status), history: this.history.view() };
    }
    const frame = this.viewport && this.frameIfChanged();
    if (frame) push.mapFrame = frame;
    this.pushCount++;
    this.onPush(frame ? this.transfer(push, frameBuffers(frame)) : push);
  }

  // ---- map ----

  /** What the cluster index is built from: statuses in the filter are applied per frame (D-072). */
  private get dataVersion(): number {
    return this.state.version + this.statusEpoch + this.filters.baseVersion;
  }

  private transfer<T>(value: T, buffers: ArrayBuffer[]): T {
    return this.deps.transfer ? this.deps.transfer(value, buffers) : value;
  }

  /** Rebuilds the index when due; schedules a later rebuild when throttled. */
  private updateIndex(): void {
    const now = this.clock.now();
    // D-072: a status-only filter change is cut from the current index first; a throttled
    // rebuild that happens to be due waits for the next push instead of delaying this frame.
    const statusOnly = !this.rebuildNow && this.filters.version !== this.frameOf.filter;
    if (!statusOnly) this.map.update(this.dataVersion, now, this.rebuildNow);
    this.rebuildNow = false;
    const wait = this.map.rebuildWait(this.dataVersion, now);
    // wait 0 = a D-072 cache swap: rebuild right after, not on an older, longer timer.
    if (wait === 0 && this.rebuildTimer !== null) {
      this.clock.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (wait !== null && this.rebuildTimer === null) {
      this.rebuildTimer = this.clock.setTimeout(() => {
        this.rebuildTimer = null;
        this.markDirty();
      }, wait);
    }
  }

  /** `update` false: the index was just updated (a D-072 cache swap must not rebuild in the same task). */
  private computeFrame(update = true): MapFrame {
    if (update) this.updateIndex();
    this.frameOf = {
      data: this.dataVersion,
      generation: this.map.generation,
      filter: this.filters.version,
    };
    return this.map.frame(this.viewport!);
  }

  private frameIfChanged(): MapFrame | null {
    this.updateIndex();
    const { data, generation, filter } = this.frameOf;
    return data === this.dataVersion &&
      generation === this.map.generation &&
      filter === this.filters.version
      ? null
      : this.computeFrame(false);
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

  /** 1 Hz full status pass, so time-based transitions happen without new messages. */
  private tickSweep(): void {
    const t0 = performance.now();
    const changed = this.status.sweep(this.now());
    this.sweepMs = performance.now() - t0;
    if (changed) {
      this.statusEpoch++;
      this.markDirty();
    }
    this.sweepTimer = this.clock.setTimeout(() => this.tickSweep(), this.rules.sweepIntervalMs);
  }
}

const toSelected = (
  { vehicleId, found, combinfo, lafparsed }: Selection,
  status: VehicleStatus | null,
): SelectedVehicle => ({
  vehicleId,
  found,
  status,
  combinfo,
  lafparsed,
});
