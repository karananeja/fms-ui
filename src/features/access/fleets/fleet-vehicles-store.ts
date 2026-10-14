import type { VehicleMeta } from '@shared/contract/index.ts';
import { accessKeys } from '../api/access-api';
import { httpFleetApi, toastNotifier, type FleetApi, type Notifier } from './fleet-tree-store';

/** F03-R6: cursor page size. */
export const VEHICLE_PAGE_SIZE = 100;

export interface FleetVehiclesState {
  fleetId: string | null;
  query: string;
  items: readonly VehicleMeta[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  /** No page answered yet for this fleet + query. */
  initial: boolean;
  selected: ReadonlySet<string>;
  /** Index of the last plain click, for shift-range selection. */
  anchor: number | null;
  moving: boolean;
}

const message = (err: unknown) =>
  err instanceof Error && err.message ? err.message : 'Something went wrong';

const fresh = (fleetId: string | null, query: string): FleetVehiclesState => ({
  fleetId,
  query,
  items: [],
  nextCursor: null,
  loading: false,
  error: null,
  initial: true,
  selected: new Set(),
  anchor: null,
  moving: false,
});

/**
 * F03-R6: the selected fleet's direct vehicles (`accessKeys.vehicles(fleetId, q)`), loaded in
 * cursor pages of 100 for infinite scroll, with multi-select and "Move to fleet…".
 */
export class FleetVehiclesStore {
  private state = fresh(null, '');
  // `fleetId: null` + `initial` means nothing is open yet.
  private readonly listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  /** The cache key of the list the current pages belong to (stale answers are dropped). */
  private key = '';

  constructor(
    private readonly api: FleetApi = httpFleetApi,
    private readonly notify: Notifier = toastNotifier,
    /** Called after vehicles move, so the tree re-reads its counts. */
    private readonly onMoved: () => void = () => {},
  ) {}

  getSnapshot = (): FleetVehiclesState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<FleetVehiclesState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Shows `fleetId`'s vehicles matching `query` from the first page. */
  open(fleetId: string | null, query = this.state.query, force = false): void {
    if (!force && fleetId === this.state.fleetId && query === this.state.query) return;
    this.abort?.abort();
    this.abort = null;
    this.state = fresh(fleetId, query);
    this.key = JSON.stringify(accessKeys.vehicles(fleetId ?? undefined, query));
    this.set({});
    if (fleetId) void this.loadMore();
  }

  setQuery(query: string): void {
    this.open(this.state.fleetId, query);
  }

  /** Next cursor page (no-op while loading or after the last page). */
  async loadMore(): Promise<void> {
    const { fleetId, query, loading, initial, nextCursor } = this.state;
    if (!fleetId || loading || (!initial && nextCursor === null)) return;
    const key = this.key;
    const ctrl = (this.abort = new AbortController());
    this.set({ loading: true, error: null });
    try {
      const page = await this.api.listVehicles(
        { fleetId, q: query, cursor: nextCursor ?? undefined, limit: VEHICLE_PAGE_SIZE },
        { signal: ctrl.signal },
      );
      if (key !== this.key) return;
      this.set({
        items: [...this.state.items, ...page.items],
        nextCursor: page.nextCursor,
        loading: false,
        initial: false,
      });
    } catch (err) {
      if (key !== this.key) return;
      this.set({ loading: false, error: message(err) });
    }
  }

  /** Checkbox click; with `range` (shift) selects everything from the anchor to `index`. */
  toggle(index: number, range = false): void {
    const { items, anchor } = this.state;
    const v = items[index];
    if (!v) return;
    const selected = new Set(this.state.selected);
    if (range && anchor !== null && items[anchor]) {
      const on = !selected.has(v.vehicleId) || selected.has(items[anchor].vehicleId);
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      for (let i = a; i <= b; i++) {
        if (on) selected.add(items[i]!.vehicleId);
        else selected.delete(items[i]!.vehicleId);
      }
      this.set({ selected });
      return;
    }
    if (selected.has(v.vehicleId)) selected.delete(v.vehicleId);
    else selected.add(v.vehicleId);
    this.set({ selected, anchor: index });
  }

  /** "Select page": every loaded vehicle, or none when all are already selected. */
  toggleAll(): void {
    const { items, selected } = this.state;
    const all = items.length > 0 && items.every((v) => selected.has(v.vehicleId));
    this.set({
      selected: all ? new Set() : new Set(items.map((v) => v.vehicleId)),
      anchor: null,
    });
  }

  clearSelection(): void {
    this.set({ selected: new Set(), anchor: null });
  }

  /** F03-R6: moves the selection into `targetId`; "Moved N vehicles", then counts refresh. */
  async moveSelected(targetId: string): Promise<boolean> {
    const ids = [...this.state.selected];
    if (ids.length === 0 || this.state.moving) return false;
    this.set({ moving: true });
    try {
      const { moved } = await this.api.moveVehicles(targetId, ids);
      this.notify.success(`Moved ${moved} vehicle${moved === 1 ? '' : 's'}`);
      const gone = new Set(ids);
      this.set({
        moving: false,
        selected: new Set(),
        anchor: null,
        // They are no longer direct members of this fleet.
        items:
          targetId === this.state.fleetId
            ? this.state.items
            : this.state.items.filter((v) => !gone.has(v.vehicleId)),
      });
      this.onMoved();
      return true;
    } catch (err) {
      this.set({ moving: false });
      this.notify.error(message(err));
      return false;
    }
  }
}
