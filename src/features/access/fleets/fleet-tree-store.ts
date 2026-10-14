import type { Fleet } from '@shared/contract/index.ts';
import { toast } from 'sonner';
import * as api from '../api/access-api';
import {
  addChildBlocker,
  buildFleetIndex,
  deleteBlocker,
  moveBlocker,
  visibleRows,
  withMove,
  type FleetIndex,
  type VisibleRow,
} from './fleet-tree-model';

/** The access calls the fleet screens use (injected in tests). */
export interface FleetApi {
  listFleets: typeof api.listFleets;
  createFleet: typeof api.createFleet;
  renameFleet: typeof api.renameFleet;
  moveFleet: typeof api.moveFleet;
  deleteFleet: typeof api.deleteFleet;
  listVehicles: typeof api.listVehicles;
  moveVehicles: typeof api.moveVehicles;
}

export const httpFleetApi: FleetApi = api;

/** Toasts (sonner in the app, a spy in tests). */
export interface Notifier {
  success(message: string): void;
  error(message: string): void;
}

export const toastNotifier: Notifier = {
  success: (m) => void toast.success(m),
  error: (m) => void toast.error(m),
};

export interface FleetTreeState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  fleets: readonly Fleet[];
  index: FleetIndex;
  expanded: ReadonlySet<string>;
  query: string;
  selectedId: string | null;
  /** Derived from `index`, `expanded` and `query`. */
  rows: readonly VisibleRow[];
}

const message = (err: unknown) =>
  err instanceof Error && err.message ? err.message : 'Something went wrong';

let tempSeq = 0;

/**
 * F03-R4/R5: the fleet tree (`accessKeys.fleets()`): flat list, expansion, search, selection,
 * and optimistic create / rename / move / delete. A failed change is undone with its inverse
 * (so a later change that succeeded survives) and the server message is toasted.
 */
export class FleetTreeStore {
  private state: FleetTreeState;
  private readonly listeners = new Set<() => void>();
  private loadAbort: AbortController | null = null;

  constructor(
    private readonly api: FleetApi = httpFleetApi,
    private readonly notify: Notifier = toastNotifier,
  ) {
    const index = buildFleetIndex([]);
    this.state = {
      status: 'idle',
      error: null,
      fleets: [],
      index,
      expanded: new Set(),
      query: '',
      selectedId: null,
      rows: [],
    };
  }

  getSnapshot = (): FleetTreeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<FleetTreeState>): void {
    const next = { ...this.state, ...patch };
    if (patch.fleets && patch.fleets !== this.state.fleets)
      next.index = buildFleetIndex(next.fleets);
    if (
      next.index !== this.state.index ||
      next.expanded !== this.state.expanded ||
      next.query !== this.state.query
    ) {
      next.rows = visibleRows(next.index, {
        isExpanded: (id) => next.expanded.has(id),
        query: next.query,
      });
    }
    if (next.selectedId !== null && !next.index.byId.has(next.selectedId)) next.selectedId = null;
    this.state = next;
    for (const l of this.listeners) l();
  }

  /**
   * Loads (or refreshes, after vehicle moves change counts) the tree. The first load expands
   * the top two levels and selects the root.
   */
  async load(): Promise<void> {
    this.loadAbort?.abort();
    const ctrl = (this.loadAbort = new AbortController());
    const first = this.state.status !== 'ready';
    if (first) this.set({ status: 'loading', error: null });
    try {
      const fleets = await this.api.listFleets({ signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (first) {
        const index = buildFleetIndex(fleets);
        const expanded = new Set<string>();
        for (const r of index.roots) {
          expanded.add(r.id);
          for (const c of index.children.get(r.id) ?? []) expanded.add(c.id);
        }
        this.set({
          status: 'ready',
          fleets,
          expanded,
          selectedId: this.state.selectedId ?? index.roots[0]?.id ?? null,
        });
      } else this.set({ fleets, status: 'ready' });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (first) this.set({ status: 'error', error: message(err) });
      else this.notify.error(message(err));
    }
  }

  /** Re-reads counts (invalidates `accessKeys.fleets()`). */
  refresh = (): Promise<void> => this.load();

  setQuery(query: string): void {
    if (query !== this.state.query) this.set({ query });
  }

  select(id: string | null): void {
    if (id !== this.state.selectedId) this.set({ selectedId: id });
  }

  setExpanded(id: string, open: boolean): void {
    if (this.state.expanded.has(id) === open) return;
    const expanded = new Set(this.state.expanded);
    if (open) expanded.add(id);
    else expanded.delete(id);
    this.set({ expanded });
  }

  toggle(id: string): void {
    this.setExpanded(id, !this.state.expanded.has(id));
  }

  expandAll(): void {
    this.set({ expanded: new Set(this.state.index.children.keys()) });
  }

  collapseAll(): void {
    this.set({ expanded: new Set() });
  }

  /** F03-R5: adds a child (optimistic, with a temporary id until the server answers). */
  async create(parentId: string, rawName: string): Promise<Fleet | null> {
    const name = rawName.trim();
    const parent = this.state.index.byId.get(parentId);
    if (!parent || !name) return null;
    const blocked = addChildBlocker(parent);
    if (blocked) {
      this.notify.error(blocked);
      return null;
    }
    const temp: Fleet = {
      id: `tmp-${++tempSeq}`,
      parentId,
      name,
      depth: parent.depth + 1,
      vehicleCount: 0,
    };
    const expanded = new Set(this.state.expanded).add(parentId);
    this.set({ fleets: [...this.state.fleets, temp], expanded });
    try {
      const created = await this.api.createFleet({ parentId, name });
      this.set({
        fleets: this.state.fleets.map((f) => (f.id === temp.id ? created : f)),
        selectedId: this.state.selectedId === temp.id ? created.id : this.state.selectedId,
      });
      return created;
    } catch (err) {
      this.set({ fleets: this.state.fleets.filter((f) => f.id !== temp.id) });
      this.notify.error(message(err));
      return null;
    }
  }

  /** F03-R5: inline rename (optimistic). */
  async rename(id: string, rawName: string): Promise<boolean> {
    const name = rawName.trim();
    const before = this.state.index.byId.get(id);
    if (!before || !name || name === before.name) return false;
    const setName = (n: string) =>
      this.set({ fleets: this.state.fleets.map((f) => (f.id === id ? { ...f, name: n } : f)) });
    setName(name);
    try {
      await this.api.renameFleet(id, name);
      return true;
    } catch (err) {
      setName(before.name);
      this.notify.error(message(err));
      return false;
    }
  }

  /** F03-R5: move under a new parent (optimistic; depths and counts follow). */
  async move(id: string, parentId: string): Promise<boolean> {
    const node = this.state.index.byId.get(id);
    if (!node || node.parentId === null || node.parentId === parentId) return false;
    const blocked = moveBlocker(this.state.index, node);
    if (blocked) {
      this.notify.error(blocked);
      return false;
    }
    const oldParent = node.parentId;
    const expanded = new Set(this.state.expanded).add(parentId);
    this.set({ fleets: withMove(this.state.fleets, id, parentId), expanded });
    try {
      await this.api.moveFleet(id, parentId);
      return true;
    } catch (err) {
      this.set({ fleets: withMove(this.state.fleets, id, oldParent) });
      this.notify.error(message(err));
      return false;
    }
  }

  /** F03-R5: delete an empty leaf (optimistic). */
  async remove(id: string): Promise<boolean> {
    const { index, fleets } = this.state;
    const node = index.byId.get(id);
    if (!node) return false;
    const blocked = deleteBlocker(index, node);
    if (blocked) {
      this.notify.error(blocked);
      return false;
    }
    const at = fleets.indexOf(node);
    const wasSelected = this.state.selectedId === id;
    this.set({
      fleets: fleets.filter((f) => f.id !== id),
      selectedId: wasSelected ? node.parentId : this.state.selectedId,
    });
    try {
      await this.api.deleteFleet(id);
      return true;
    } catch (err) {
      const now = [...this.state.fleets];
      if (node.parentId === null || this.state.index.byId.has(node.parentId)) {
        now.splice(Math.min(at, now.length), 0, node);
        this.set({ fleets: now, selectedId: wasSelected ? id : this.state.selectedId });
      }
      this.notify.error(message(err));
      return false;
    }
  }
}
