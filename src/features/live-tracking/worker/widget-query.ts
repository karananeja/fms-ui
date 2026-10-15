import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { TableRow, TableSort } from '../config/table-columns.ts';
import type { FleetNode } from './filter-engine.ts';
import type { FleetState } from './fleet-state.ts';
import { isValidPosition } from './position.ts';
import {
  runLiveCustom,
  type LiveCustomQuery,
  type LiveCustomResult,
  type LivePoints,
} from './widget-custom-query.ts';

export type { LiveCustomQuery, LiveCustomResult, LivePoints };

/** F20 §9: a `vehicle-list` widget filter (F18), no search/models. Same semantics as F08. */
export interface LiveListFilter {
  statuses?: VehicleStatus[];
  fleetIds?: string[];
  assetTypes?: string[];
  fuelTypes?: string[];
  makes?: string[];
  socMin?: number;
  socMax?: number;
}

export type LiveWidgetQuery =
  | { kind: 'counts'; fleetId?: string }
  | { kind: 'list'; filter: LiveListFilter; sort: TableSort; limit: number }
  | LiveCustomQuery;

export type LiveWidgetResult =
  | { kind: 'counts'; counts: Record<VehicleStatus, number>; total: number }
  | { kind: 'list'; total: number; rows: TableRow[] }
  | LiveCustomResult;

export interface LiveWidgetBatch {
  /** Fleet data version (rows + status sweep), not the filter version. */
  version: number;
  /** The first complete snapshot has arrived. */
  ready: boolean;
  /** `null` when `version === sinceVersion` (nothing changed). */
  results: LiveWidgetResult[] | null;
}

export const MAX_WIDGET_QUERIES = 24;
export const MAX_WIDGET_LIST_LIMIT = 50;

export interface WidgetQuerySource {
  state: FleetState;
  /** Fleet data version (state rows + status sweeps). */
  dataVersion(): number;
  ready(): boolean;
  /** Global per-status counts (O(1), from the status tracker). */
  statusCounts(): Record<VehicleStatus, number>;
  fleetNames(): Readonly<Record<string, string>>;
  /** Row builder shared with the F09 table. */
  row(i: number): TableRow;
}

type Key = number | string;

/**
 * D-129: read-only queries for dashboard widgets. Its own predicate per query (never the global
 * filter, viewport, selection, table order or tray), results cached per (query, data version).
 */
export class WidgetQueryEngine {
  private children = new Map<string, string[]>();
  private cache = new Map<string, LiveWidgetResult>();
  private cacheVersion = -1;
  scans = 0;

  constructor(private readonly src: WidgetQuerySource) {}

  setFleets(fleets: readonly FleetNode[]): void {
    this.children = new Map();
    for (const { id, parentId } of fleets) {
      if (parentId === null) continue;
      this.children.set(parentId, [...(this.children.get(parentId) ?? []), id]);
    }
    this.cache.clear();
  }

  setFleetNamesChanged(): void {
    this.cache.clear();
  }

  query(queries: readonly LiveWidgetQuery[], sinceVersion?: number): LiveWidgetBatch {
    const version = this.src.dataVersion();
    const ready = this.src.ready();
    if (sinceVersion === version) return { version, ready, results: null };
    if (version !== this.cacheVersion) {
      this.cache.clear();
      this.cacheVersion = version;
    }
    const results = queries.slice(0, MAX_WIDGET_QUERIES).map((q) => {
      const key = JSON.stringify(q);
      let r = this.cache.get(key);
      if (!r) {
        if (q.kind === 'custom') {
          this.scans++;
          r = runLiveCustom(this.src.state, q, (ids) => this.subtree(ids));
        } else r = q.kind === 'counts' ? this.counts(q.fleetId) : this.list(q);
        this.cache.set(key, r);
      }
      return r;
    });
    return { version, ready, results };
  }

  private counts(fleetId?: string): LiveWidgetResult {
    if (!fleetId) {
      return { kind: 'counts', counts: this.src.statusCounts(), total: this.src.state.count };
    }
    this.scans++;
    const test = this.compile({ fleetIds: [fleetId] });
    const raw = new Uint32Array(VEHICLE_STATUSES.length + 1);
    const status = this.src.state.cols.status!;
    let total = 0;
    for (let i = 0; i < this.src.state.count; i++) {
      if (test && !test(i)) continue;
      raw[status[i]!]!++;
      total++;
    }
    const counts = {} as Record<VehicleStatus, number>;
    VEHICLE_STATUSES.forEach((s, k) => (counts[s] = raw[k + 1]!));
    // Like the status bar: `total` counts every vehicle, `counts` only those with a status.
    return { kind: 'counts', counts, total };
  }

  private list(q: Extract<LiveWidgetQuery, { kind: 'list' }>): LiveWidgetResult {
    this.scans++;
    const { state } = this.src;
    const test = this.compile(q.filter);
    const limit = Math.max(0, Math.min(q.limit, MAX_WIDGET_LIST_LIMIT));
    const keyOf = this.keyFn(q.sort.column);
    const sign = q.sort.dir === 'asc' ? 1 : -1;
    const ids = state.str.vehicleId;
    // Missing values last in both directions, then the vehicle id (same rules as F09).
    const cmp = (x: Key, i: number, y: Key, j: number) => {
      const xm = x === '' || x !== x; // NaN
      const ym = y === '' || y !== y;
      if (xm !== ym) return xm ? 1 : -1;
      if (!xm && x !== y) return (x < y ? -1 : 1) * sign;
      return ids[i]! < ids[j]! ? -1 : 1;
    };
    const keys: Key[] = [];
    const rows: number[] = [];
    let total = 0;
    for (let i = 0; i < state.count; i++) {
      if (test && !test(i)) continue;
      total++;
      if (limit === 0) continue;
      const key = keyOf(i);
      const n = rows.length;
      if (n === limit && cmp(key, i, keys[n - 1]!, rows[n - 1]!) >= 0) continue;
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cmp(keys[mid]!, rows[mid]!, key, i) <= 0) lo = mid + 1;
        else hi = mid;
      }
      keys.splice(lo, 0, key);
      rows.splice(lo, 0, i);
      if (rows.length > limit) {
        keys.pop();
        rows.pop();
      }
    }
    return { kind: 'list', total, rows: rows.map((i) => this.src.row(i)) };
  }

  private keyFn(column: TableSort['column']): (i: number) => Key {
    const { cols, str, codes, dicts } = this.src.state;
    switch (column) {
      case 'regno':
      case 'vin':
      case 'deviceId':
        return (i) => str[column][i]!.toUpperCase();
      case 'fleet': {
        const names = this.src.fleetNames();
        return (i) => {
          const id = dicts.fleetId.values[codes.fleetId[i]!]!;
          return (names[id] ?? id).toUpperCase();
        };
      }
      case 'status':
        return (i) => cols.status![i]! || NaN;
      case 'ignition':
        return (i) => (cols.ignstatus[i] === -1 ? NaN : cols.ignstatus[i]!);
      case 'location':
        return (i) => (isValidPosition(cols.lat[i]!, cols.lng[i]!) ? cols.lat[i]! : NaN);
      default:
        return (i) => cols[column][i]!;
    }
  }

  /** AND across fields, OR within; `fleetIds` include their subtrees; SoC bounds inclusive. */
  private compile(f: LiveListFilter): ((i: number) => boolean) | null {
    const { state } = this.src;
    const checks: ((i: number) => boolean)[] = [];
    const dict = (
      list: string[] | undefined,
      field: 'fleetId' | 'assetType' | 'fuelType' | 'make',
    ) => {
      if (!list?.length) return;
      const allowed = new Set(field === 'fleetId' ? this.subtree(list) : list);
      // Dictionary codes → allowed flag, so the per-row test is two array reads.
      const values = state.dicts[field].values;
      const ok = new Uint8Array(values.length + 1);
      values.forEach((v, k) => (ok[k] = allowed.has(v!) ? 1 : 0));
      const codes = state.codes[field];
      checks.push((i) => ok[codes[i]!] === 1);
    };
    dict(f.fleetIds, 'fleetId');
    dict(f.assetTypes, 'assetType');
    dict(f.fuelTypes, 'fuelType');
    dict(f.makes, 'make');
    if (f.statuses?.length) {
      let bits = 0;
      for (const s of f.statuses) bits |= 1 << (VEHICLE_STATUSES.indexOf(s) + 1);
      const status = state.cols.status!;
      checks.push((i) => (bits & (1 << status[i]!)) !== 0);
    }
    if (f.socMin !== undefined || f.socMax !== undefined) {
      const lo = f.socMin ?? -Infinity;
      const hi = f.socMax ?? Infinity;
      const soc = state.cols.soc;
      checks.push((i) => soc[i]! >= lo && soc[i]! <= hi);
    }
    if (!checks.length) return null;
    if (checks.length === 1) return checks[0]!;
    const n = checks.length;
    return (i) => {
      for (let k = 0; k < n; k++) if (!checks[k]!(i)) return false;
      return true;
    };
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
