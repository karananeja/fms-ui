import type { Me, Permission } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { proxy, releaseProxy, wrap, type Remote } from 'comlink';
import type { IndiaCity } from '../config/india-cities.ts';
import { detailsConfig } from '../config/details-config.ts';
import { mapConfig } from '../config/map-config.ts';
import { isValidPosition } from '../worker/position.ts';
import type {
  Bbox,
  ConnectionState,
  LivePush,
  LiveStats,
  LiveTrackingWorkerApi,
  MapFrame,
  MapViewport,
  CsvRequest,
  CsvResult,
  SelectedVehicle,
  TableQuery,
  TableResult,
  TrayCard,
  VehicleSummary,
} from '../worker/worker-api.ts';

export type LngLat = [number, number];

/** Camera moves the store decides on and `map-controller` executes. */
export type MapCommand =
  | { type: 'fit'; bounds: Bbox; padding: number; maxZoom?: number }
  | { type: 'fly'; center: LngLat; zoom: number; duration: number }
  | { type: 'ease'; center: LngLat; zoom: number }
  | { type: 'resize' };

export interface Notice {
  id: number;
  message: string;
}

export interface LiveTrackingState {
  connection: ConnectionState;
  stats: LiveStats;
  /** Vehicles per derived status; sums to `total`. */
  statusCounts: Record<VehicleStatus, number>;
  total: number;
  selectedVehicleId: string | null;
  selected: SelectedVehicle | null;
  /** Slim fleet record of the selected vehicle, fetched on selection (header before payloads). */
  selectedSummary: VehicleSummary | null;
  /** The signed-in user's permissions (from bootstrap `me`). */
  permissions: readonly Permission[];
  /** Clusters/points for the current map viewport (null until the map asks). */
  mapFrame: MapFrame | null;
  /** Transient message for a toast. */
  notice: Notice | null;
  /** Selected vehicle's recent path, oldest first (F07-R12); null when nothing is selected. */
  trail: LngLat[] | null;
}

/** Main-thread counters for e2e budgets (`performance.now()` ms; 0 = not yet). */
export interface LiveTrackingMetrics {
  pushCount: number;
  firstDataAt: number;
  snapshotCompleteAt: number;
}

export interface LiveTrackingStoreDeps {
  createWorkerApi: () => Remote<LiveTrackingWorkerApi>;
  /** `[lng, lat]` points of the last `minutes` (oldest first). Defaults to the REST endpoint. */
  fetchTrail?: (vehicleId: string, minutes: number) => Promise<LngLat[]>;
}

/** `GET /api/vehicles/:id/trail` (F07-R12); failures leave the trail to live positions only. */
export async function fetchTrail(vehicleId: string, minutes: number): Promise<LngLat[]> {
  const res = await fetch(
    `/api/vehicles/${encodeURIComponent(vehicleId)}/trail?minutes=${minutes}`,
    { credentials: 'include' },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { points: [number, number, number][] };
  return body.points.map(([lng, lat]) => [lng, lat]);
}

const emptyStats: LiveStats = {
  vehicleCount: 0,
  snapshotComplete: false,
  rowsPerSec: 0,
  msgsPerSec: 0,
  lastMessageAt: 0,
  reconnects: 0,
  stateBytes: 0,
  serverOffsetMs: 0,
  sweepMs: 0,
  clusterBuildMs: 0,
};

const emptyCounts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<
  VehicleStatus,
  number
>;

const sameCounts = (a: Record<VehicleStatus, number>, b: Record<VehicleStatus, number>) =>
  VEHICLE_STATUSES.every((s) => a[s] === b[s]);

const initialState: LiveTrackingState = {
  connection: 'offline',
  stats: emptyStats,
  statusCounts: emptyCounts,
  total: 0,
  selectedVehicleId: null,
  selected: null,
  selectedSummary: null,
  permissions: [],
  mapFrame: null,
  notice: null,
  trail: null,
};

export const hasPermission = (state: LiveTrackingState, permission: Permission): boolean =>
  state.permissions.includes(permission);

/** Live position of the selected vehicle: its payload, else its point in the current frame. */
export function selectedPosition(state: LiveTrackingState): LngLat | null {
  const id = state.selectedVehicleId;
  if (!id) return null;
  const c = state.selected?.combinfo;
  if (c && isValidPosition(c.latitude, c.longitude)) return [c.longitude, c.latitude];
  const p = state.mapFrame?.points;
  const k = p ? p.ids.indexOf(id) : -1;
  return k < 0 ? null : [p!.lng[k]!, p!.lat[k]!];
}

/** Main-thread facade over the live-tracking worker. Holds UI state and small worker results only. */
export class LiveTrackingStore {
  readonly metrics: LiveTrackingMetrics = { pushCount: 0, firstDataAt: 0, snapshotCompleteAt: 0 };
  private state = initialState;
  private api: Remote<LiveTrackingWorkerApi> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(cmd: MapCommand) => void>();
  private viewport: MapViewport | null = null;
  private autoFit = false;
  private noticeSeq = 0;

  constructor(private readonly deps: LiveTrackingStoreDeps) {}

  start(me: Me): void {
    if (this.api) return;
    this.api = this.deps.createWorkerApi();
    const permissions = me.permissions ?? [];
    if (permissions.join() !== this.state.permissions.join())
      this.set({ ...this.state, permissions });
    void this.api.init(
      me,
      proxy((push: LivePush) => this.receive(push)),
    );
  }

  stop(): void {
    const api = this.api;
    if (!api) return;
    this.api = null;
    void api.dispose();
    api[releaseProxy]();
    this.autoFit = false;
    this.set(initialState);
  }

  /** True once the one automatic zoom-to-fit (first completed snapshot) has been issued. */
  get autoFitDone(): boolean {
    return this.autoFit;
  }

  onMapCommand = (listener: (cmd: MapCommand) => void): (() => void) => {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveTrackingState => this.state;

  async selectVehicle(vehicleId: string | null): Promise<void> {
    if (vehicleId === this.state.selectedVehicleId) return;
    this.set({
      ...this.state,
      selectedVehicleId: vehicleId,
      selected: null,
      selectedSummary: null,
      trail: vehicleId ? [] : null,
    });
    const api = this.api;
    const found = (await api?.selectVehicle(vehicleId)) ?? false;
    if (vehicleId === null || this.state.selectedVehicleId !== vehicleId) return;
    if (!found) {
      this.set({
        ...this.state,
        selected: { vehicleId, found: false, status: null, combinfo: null, lafparsed: null },
      });
      return;
    }
    void this.loadTrail(vehicleId);
    const summary = await api!.getVehicleSummary(vehicleId);
    if (summary && this.state.selectedVehicleId === vehicleId) {
      this.set({ ...this.state, selectedSummary: summary });
    }
  }

  private async loadTrail(vehicleId: string): Promise<void> {
    const load = this.deps.fetchTrail ?? fetchTrail;
    const points = await load(vehicleId, detailsConfig.trailMinutes).catch(() => []);
    if (this.state.selectedVehicleId !== vehicleId || !this.state.trail) return;
    // Live positions that arrived meanwhile stay after the fetched history.
    const last = points.at(-1);
    const live = this.state.trail.filter((p) => !last || p[0] !== last[0] || p[1] !== last[1]);
    this.set({ ...this.state, trail: [...points, ...live] });
  }

  /** The map's settled viewport (`null` when the map unmounts). */
  async setViewport(viewport: MapViewport | null): Promise<void> {
    this.viewport = viewport;
    if (!viewport) this.set({ ...this.state, mapFrame: null });
    const frame = await this.api?.setViewport(viewport);
    if (frame) this.acceptFrame(frame);
    this.maybeAutoFit();
  }

  /** Selects the vehicle and flies to its current position once (no follow). */
  async locateVehicle(vehicleId: string): Promise<void> {
    void this.selectVehicle(vehicleId);
    const v = await this.api?.getVehicleSummary(vehicleId);
    if (!v || !isValidPosition(v.lat, v.lng)) return this.notify('No location available');
    this.command({
      type: 'fly',
      center: [v.lng, v.lat],
      zoom: mapConfig.locateZoom,
      duration: mapConfig.locateDurationMs,
    });
  }

  /** Fits all vehicles with a position (a single point is flown to). False when there are none. */
  async fitToVehicles(): Promise<boolean> {
    const bounds = (await this.api?.getBounds()) ?? null;
    if (!bounds) return false;
    const [w, s, e, n] = bounds;
    this.command(
      w === e && s === n
        ? { type: 'fly', center: [w, s], zoom: mapConfig.singlePointZoom, duration: 1000 }
        : { type: 'fit', bounds, padding: mapConfig.fitPadding, maxZoom: mapConfig.fitMaxZoom },
    );
    return true;
  }

  /** Pans to a city; does not filter (C14). */
  jumpToCity(city: IndiaCity): void {
    this.command({ type: 'fit', bounds: city.bbox, padding: 0 });
  }

  /** Zooms into a cluster, centred on it. */
  async zoomToCluster(clusterId: number, center: LngLat, zoom: number): Promise<void> {
    const z = (await this.api?.getClusterExpansionZoom(clusterId)) ?? zoom + 2;
    this.command({ type: 'ease', center, zoom: Math.max(z, zoom + 1) });
  }

  /**
   * Map click: a vehicle opens its details only with `vehicle.details.view` (F07-R13; otherwise
   * the hover tooltip is all there is); empty map clears the selection (F07-R16).
   */
  clickMap(vehicleId: string | null): void {
    if (vehicleId) {
      if (hasPermission(this.state, 'vehicle.details.view')) void this.selectVehicle(vehicleId);
    } else if (this.state.selectedVehicleId) {
      void this.selectVehicle(null);
    }
  }

  // ---- F09: table, CSV, tray (worker passthroughs) ----

  /** The map's last settled bbox (null before the map reported one). */
  get viewportBbox(): Bbox | null {
    return this.viewport?.bbox ?? null;
  }

  async setFleetNames(names: Record<string, string>): Promise<void> {
    await this.api?.setFleetNames(names);
  }

  async queryTable(query: TableQuery): Promise<TableResult | null> {
    return (await this.api?.queryTable(query)) ?? null;
  }

  async exportCsv(
    req: CsvRequest,
    onProgress: (done: number, total: number) => void,
  ): Promise<CsvResult | null> {
    return (await this.api?.exportCsv(req, proxy(onProgress))) ?? null;
  }

  async getTray(bbox: Bbox): Promise<TrayCard[]> {
    return (await this.api?.getTray(bbox)) ?? [];
  }

  /** Asks the map to re-measure its container (layout around it changed). */
  resizeMap(): void {
    this.command({ type: 'resize' });
  }

  notify(message: string): void {
    this.set({ ...this.state, notice: { id: ++this.noticeSeq, message } });
  }

  dismissNotice(id: number): void {
    if (this.state.notice?.id === id) this.set({ ...this.state, notice: null });
  }

  private command(cmd: MapCommand): void {
    for (const l of this.commandListeners) l(cmd);
  }

  /** F06-R16: once, on the first completed snapshot, as soon as the map has a viewport. */
  private maybeAutoFit(): void {
    if (this.autoFit || !this.viewport || !this.state.stats.snapshotComplete) return;
    this.autoFit = true;
    void this.fitToVehicles();
  }

  /** Frames from pushes and `setViewport` replies may interleave; the newest wins. */
  private isNewFrame(frame: MapFrame | null | undefined): frame is MapFrame {
    const current = this.state.mapFrame;
    return !!frame && !!this.viewport && (!current || frame.version > current.version);
  }

  private acceptFrame(frame: MapFrame): void {
    if (this.isNewFrame(frame)) this.set({ ...this.state, mapFrame: frame });
  }

  private receive(push: LivePush): void {
    const m = this.metrics;
    m.pushCount++;
    if (!m.firstDataAt && push.stats.vehicleCount > 0) m.firstDataAt = performance.now();
    if (!m.snapshotCompleteAt && push.stats.snapshotComplete) {
      m.snapshotCompleteAt = performance.now();
    }
    const next = {
      ...this.state,
      connection: push.connection,
      stats: push.stats,
      total: push.total,
      statusCounts: sameCounts(push.statusCounts, this.state.statusCounts)
        ? this.state.statusCounts
        : push.statusCounts,
    };
    if (push.selected !== undefined && push.selected?.vehicleId === this.state.selectedVehicleId) {
      next.selected = push.selected;
      next.trail = appendTrail(this.state.trail, push.selected);
    }
    if (this.isNewFrame(push.mapFrame)) next.mapFrame = push.mapFrame;
    this.set(next);
    this.maybeAutoFit();
  }

  private set(state: LiveTrackingState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.listeners) l();
  }
}

/** Appends the selected vehicle's live position when it moved (same array otherwise). */
function appendTrail(trail: LngLat[] | null, selected: SelectedVehicle | null): LngLat[] | null {
  const c = selected?.combinfo;
  if (!trail || !c || !isValidPosition(c.latitude, c.longitude)) return trail;
  const last = trail.at(-1);
  if (last && last[0] === c.longitude && last[1] === c.latitude) return trail;
  return [...trail, [c.longitude, c.latitude]];
}

const createWorkerApi = () =>
  wrap<LiveTrackingWorkerApi>(
    new Worker(new URL('../worker/live-tracking-worker.ts', import.meta.url), { type: 'module' }),
  );

export const liveTrackingStore = new LiveTrackingStore({ createWorkerApi });
