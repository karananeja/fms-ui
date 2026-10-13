import type { Me } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { proxy, releaseProxy, wrap, type Remote } from 'comlink';
import type {
  ConnectionState,
  LivePush,
  LiveStats,
  LiveTrackingWorkerApi,
  SelectedVehicle,
} from '../worker/worker-api.ts';

export interface LiveTrackingState {
  connection: ConnectionState;
  stats: LiveStats;
  /** Vehicles per derived status; sums to `total`. */
  statusCounts: Record<VehicleStatus, number>;
  total: number;
  selectedVehicleId: string | null;
  selected: SelectedVehicle | null;
}

/** Main-thread counters for e2e budgets (`performance.now()` ms; 0 = not yet). */
export interface LiveTrackingMetrics {
  pushCount: number;
  firstDataAt: number;
  snapshotCompleteAt: number;
}

export interface LiveTrackingStoreDeps {
  createWorkerApi: () => Remote<LiveTrackingWorkerApi>;
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
};

/** Main-thread facade over the live-tracking worker. Holds UI state and small worker results only. */
export class LiveTrackingStore {
  readonly metrics: LiveTrackingMetrics = { pushCount: 0, firstDataAt: 0, snapshotCompleteAt: 0 };
  private state = initialState;
  private api: Remote<LiveTrackingWorkerApi> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: LiveTrackingStoreDeps) {}

  start(me: Me): void {
    if (this.api) return;
    this.api = this.deps.createWorkerApi();
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
    this.set(initialState);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveTrackingState => this.state;

  async selectVehicle(vehicleId: string | null): Promise<void> {
    if (vehicleId === this.state.selectedVehicleId) return;
    this.set({ ...this.state, selectedVehicleId: vehicleId, selected: null });
    const found = (await this.api?.selectVehicle(vehicleId)) ?? false;
    if (vehicleId !== null && !found && this.state.selectedVehicleId === vehicleId) {
      this.set({
        ...this.state,
        selected: { vehicleId, found: false, status: null, combinfo: null, lafparsed: null },
      });
    }
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
    }
    this.set(next);
  }

  private set(state: LiveTrackingState): void {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.listeners) l();
  }
}

const createWorkerApi = () =>
  wrap<LiveTrackingWorkerApi>(
    new Worker(new URL('../worker/live-tracking-worker.ts', import.meta.url), { type: 'module' }),
  );

export const liveTrackingStore = new LiveTrackingStore({ createWorkerApi });
