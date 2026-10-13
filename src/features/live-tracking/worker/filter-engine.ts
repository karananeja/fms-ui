import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { FleetState } from './fleet-state.ts';

export type SearchField = 'all' | 'vin' | 'regno' | 'deviceId';

/** F08-R1: AND across fields, OR within a field; `fleetIds` include their subtrees. */
export interface VehicleFilter {
  statuses?: VehicleStatus[];
  fleetIds?: string[];
  assetTypes?: string[];
  fuelTypes?: string[];
  makes?: string[];
  models?: string[];
  socMin?: number;
  socMax?: number;
  search?: { field: SearchField; prefix: string };
}

/** A fleet-tree edge (from `/api/fleets`), used to expand `fleetIds` to their subtrees. */
export interface FleetNode {
  id: string;
  parentId: string | null;
}

/** Searchable fields, in suggestion order. */
export const SEARCH_FIELDS = ['regno', 'vin', 'deviceId'] as const;

type DictKey = 'fleetId' | 'assetType' | 'fuelType' | 'make' | 'model';
type ListKey = 'fleetIds' | 'assetTypes' | 'fuelTypes' | 'makes' | 'models';
const DICT_FILTERS: [ListKey, DictKey][] = [
  ['fleetIds', 'fleetId'],
  ['assetTypes', 'assetType'],
  ['fuelTypes', 'fuelType'],
  ['makes', 'make'],
  ['models', 'model'],
];

/** True when the filter restricts nothing. */
export const isEmptyFilter = (f: VehicleFilter): boolean =>
  !f.statuses?.length &&
  DICT_FILTERS.every(([k]) => !f[k]?.length) &&
  f.socMin === undefined &&
  f.socMax === undefined &&
  !f.search?.prefix.trim();

/**
 * Shared F08/F09 contract (F08 spec §5). Consumers (map index, table, CSV, tray) only call
 * `matches(i)` and read `version`.
 *
 * `base` is a `Uint8Array` mask over every field **except** `statuses`, kept per row through the
 * fleet-state hooks; statuses are tested against the live status column in `matches`, so the
 * 1 Hz status sweep needs no mask pass (D-064).
 */
export class FilterEngine {
  /** Duration of the last full mask pass (ms). */
  setMs = 0;
  private filter: VehicleFilter = {};
  private _version = 0;
  private base = new Uint8Array(0);
  private empty = true;
  private statusBits = 0;
  private children = new Map<string, string[]>();
  private test: ((i: number) => boolean) | null = null;
  private _baseVersion = 0;
  private baseKey: string | null = '{}';

  constructor(private readonly state: FleetState) {
    state.addHooks({
      rowChanged: (i) => this.rowChanged(i),
      beforeRemove: (i) => this.beforeRemove(i),
    });
  }

  /** Bumps on every filter change and whenever a row's match flips (rows, not statuses). */
  get version(): number {
    return this._version;
  }

  /**
   * D-072: like `version`, but ignores `statuses`: bumps only when the non-status part of the
   * filter (or the fleet tree) changes, or a row's non-status match flips.
   */
  get baseVersion(): number {
    return this._baseVersion;
  }

  /** D-072: true when some field other than `statuses` restricts the set. */
  get baseActive(): boolean {
    return this.test !== null;
  }

  /** D-072: selected statuses as a bitmask over status codes (bit `code`); 0 = all. */
  get statusMask(): number {
    return this.statusBits;
  }

  get current(): VehicleFilter {
    return this.filter;
  }

  get active(): boolean {
    return !this.empty;
  }

  get matchCount(): number {
    if (this.empty) return this.state.count;
    let n = 0;
    for (let i = 0; i < this.state.count; i++) if (this.matches(i)) n++;
    return n;
  }

  /** Fleet tree for subtree expansion; re-applies the current filter. */
  setFleets(fleets: readonly FleetNode[]): void {
    this.children = new Map();
    for (const { id, parentId } of fleets) {
      if (parentId === null) continue;
      this.children.set(parentId, [...(this.children.get(parentId) ?? []), id]);
    }
    this.baseKey = null;
    this.set(this.filter);
  }

  set(filter: VehicleFilter): void {
    const t0 = performance.now();
    this.filter = filter;
    this.empty = isEmptyFilter(filter);
    this.statusBits = 0;
    for (const s of filter.statuses ?? [])
      this.statusBits |= 1 << (VEHICLE_STATUSES.indexOf(s) + 1);
    // D-072: a change in `statuses` alone keeps the base mask (and `baseVersion`).
    const key = JSON.stringify({ ...filter, statuses: undefined });
    if (key !== this.baseKey) {
      this.baseKey = key;
      this.test = this.compile(filter);
      this.ensureCapacity();
      const n = this.state.count;
      const test = this.test;
      if (test) for (let i = 0; i < n; i++) this.base[i] = test(i) ? 1 : 0;
      else this.base.fill(1, 0, n);
      this._baseVersion++;
    }
    this._version++;
    this.setMs = performance.now() - t0;
  }

  /** D-072: matches every field except `statuses`. */
  matchesBase(i: number): boolean {
    if (i < 0 || i >= this.state.count) return false;
    return this.test === null || this.base[i] === 1;
  }

  matches(i: number): boolean {
    if (i < 0 || i >= this.state.count) return false;
    if (this.empty) return true;
    if (this.base[i] !== 1) return false;
    return this.statusBits === 0 || (this.statusBits & (1 << this.state.cols.status![i]!)) !== 0;
  }

  /** Per-status counts over every field except `statuses` (F08-R3), and the total over all. */
  counts(): { counts: Record<VehicleStatus, number>; total: number } {
    const raw = new Uint32Array(VEHICLE_STATUSES.length + 1);
    const status = this.state.cols.status!;
    let total = 0;
    for (let i = 0; i < this.state.count; i++) {
      if (!this.empty && this.base[i] !== 1) continue;
      const s = status[i]!;
      raw[s]!++;
      if (this.statusBits === 0 || this.statusBits & (1 << s)) total++;
    }
    const counts = {} as Record<VehicleStatus, number>;
    VEHICLE_STATUSES.forEach((s, k) => (counts[s] = raw[k + 1]!));
    return { counts, total };
  }

  private rowChanged(i: number): void {
    this.ensureCapacity();
    const next = !this.test || this.test(i) ? 1 : 0;
    if (this.base[i] === next) return;
    this.base[i] = next;
    if (this.test) this._baseVersion++;
    if (!this.empty) this._version++;
  }

  /** Mirrors the fleet state's swap-remove. */
  private beforeRemove(i: number): void {
    this.base[i] = this.base[this.state.count - 1]!;
    if (this.test) this._baseVersion++;
    if (!this.empty) this._version++;
  }

  private ensureCapacity(): void {
    if (this.base.length >= this.state.capacity) return;
    const next = new Uint8Array(this.state.capacity);
    next.set(this.base);
    this.base = next;
  }

  /** Columns are read from the state on every call: `FleetState.grow()` replaces them. */
  private compile(f: VehicleFilter): ((i: number) => boolean) | null {
    const state = this.state;
    const checks: ((i: number) => boolean)[] = [];
    for (const [key, field] of DICT_FILTERS) {
      const list = f[key];
      if (!list?.length) continue;
      const allowed = new Set(key === 'fleetIds' ? this.subtree(list) : list);
      checks.push((i) => allowed.has(state.dicts[field].values[state.codes[field][i]!]!));
    }
    if (f.socMin !== undefined || f.socMax !== undefined) {
      const lo = f.socMin ?? -Infinity;
      const hi = f.socMax ?? Infinity;
      checks.push((i) => {
        const soc = state.cols.soc[i]!;
        return soc >= lo && soc <= hi;
      });
    }
    const prefix = f.search?.prefix.trim().toUpperCase();
    if (prefix) {
      const fields = f.search!.field === 'all' ? SEARCH_FIELDS : [f.search!.field];
      checks.push((i) => fields.some((k) => state.str[k][i]!.toUpperCase().startsWith(prefix)));
    }
    if (!checks.length) return null;
    return (i) => checks.every((c) => c(i));
  }

  private subtree(ids: readonly string[]): string[] {
    const out = new Set<string>();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(this.children.get(id) ?? []));
    }
    return [...out];
  }
}
