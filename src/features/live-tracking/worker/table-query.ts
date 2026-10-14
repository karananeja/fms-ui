import type { TableColumnId, TableRow, TableSort } from '../config/table-columns.ts';
import type { FleetState } from './fleet-state.ts';
import { isValidPosition } from './position.ts';
import { statusOfCode } from './status-deriver.ts';
import type { Bbox } from './worker-api.ts';

export type TableScope = 'all' | 'viewport';

export interface TableQuery {
  scope: TableScope;
  /** Required for `viewport`: the map bbox captured when switching to the table. */
  bbox?: Bbox | null;
  sort: TableSort;
  offset: number;
  limit: number;
}

export interface TableResult {
  total: number;
  rows: TableRow[];
  /** Data version the order was built from (changes when vehicles, statuses or the filter do). */
  version: number;
}

export const MAX_TABLE_LIMIT = 200;
/** While live, the cached order is rebuilt at most this often (F09-R3). */
export const RESORT_MS = 1000;

const num = (v: number) => (Number.isFinite(v) ? v : null);

interface Order {
  key: string;
  version: number;
  builtAt: number;
  /** Vehicle ids in display order: ids survive the fleet state's swap-remove, row indices don't. */
  ids: string[];
}

/**
 * F09-R3: sort + window over matching vehicles (all or a bbox). The sorted order is cached per
 * scope/bbox/sort and rebuilt when the data changed, at most every `RESORT_MS`; rows in a window
 * are read live. Iterates only `matches(i)` (F08 contract).
 */
export class TableQueryEngine {
  sortMs = 0;
  sorts = 0;
  private order: Order | null = null;
  private fleetNames: Readonly<Record<string, string>> = {};

  constructor(
    private readonly state: FleetState,
    private readonly matches: (i: number) => boolean,
    private readonly dataVersion: () => number,
    private readonly now: () => number,
  ) {}

  setFleetNames(names: Readonly<Record<string, string>>): void {
    this.fleetNames = names;
    this.order = null;
  }

  query(q: Omit<TableQuery, 'offset' | 'limit'> & { offset: number; limit: number }): TableResult {
    const order = this.ensureOrder(q);
    const limit = Math.max(0, Math.min(q.limit, MAX_TABLE_LIMIT));
    const rows: TableRow[] = [];
    for (let k = q.offset; k < order.ids.length && rows.length < limit; k++) {
      const i = this.state.byVehicle.get(order.ids[k]!);
      // Removed since the order was built (≤ RESORT_MS ago): skipped, total catches up next sort.
      if (i !== undefined) rows.push(this.row(i));
    }
    return { total: order.ids.length, rows, version: order.version };
  }

  /** The same order the table shows (for the CSV), rebuilt only under the same rules. */
  orderedIds(q: Omit<TableQuery, 'offset' | 'limit'>): { ids: readonly string[]; version: number } {
    const o = this.ensureOrder(q);
    return { ids: o.ids, version: o.version };
  }

  row(i: number): TableRow {
    const { cols, str, codes, dicts } = this.state;
    const lat = cols.lat[i]!;
    const lng = cols.lng[i]!;
    const valid = isValidPosition(lat, lng);
    const ign = cols.ignstatus[i]!;
    return {
      vehicleId: str.vehicleId[i]!,
      regno: str.regno[i]!,
      vin: str.vin[i]!,
      deviceId: str.deviceId[i]!,
      fleetId: dicts.fleetId.values[codes.fleetId[i]!]!,
      status: statusOfCode(cols.status?.[i] ?? 0),
      speed: num(cols.speed[i]!),
      soc: num(cols.soc[i]!),
      dte: num(cols.dte[i]!),
      odometer: num(cols.odometer[i]!),
      ignition: ign === 0 || ign === 1 ? ign : null,
      gpstime: num(cols.gpstime[i]!),
      canutctime: num(cols.canutctime[i]!),
      lat: valid ? lat : null,
      lng: valid ? lng : null,
    };
  }

  private ensureOrder(q: Omit<TableQuery, 'offset' | 'limit'>): Order {
    const key = `${q.scope}|${q.scope === 'viewport' ? (q.bbox ?? []).join(',') : ''}|${q.sort.column}|${q.sort.dir}`;
    const version = this.dataVersion();
    const now = this.now();
    const o = this.order;
    if (o && o.key === key && (o.version === version || now - o.builtAt < RESORT_MS)) return o;
    const t0 = performance.now();
    const ids = this.sorted(q);
    this.order = { key, version, builtAt: now, ids };
    this.sorts++;
    this.sortMs = performance.now() - t0;
    return this.order;
  }

  /** Matching rows in scope, sorted by the column then vehicle id (stable, deterministic). */
  private sorted({ scope, bbox, sort }: Omit<TableQuery, 'offset' | 'limit'>): string[] {
    const { lat, lng } = this.state.cols;
    const n = this.state.count;
    const rows: number[] = [];
    const box = scope === 'viewport' ? bbox : null;
    if (scope === 'viewport' && !box) return [];
    for (let i = 0; i < n; i++) {
      if (!this.matches(i)) continue;
      if (box) {
        const y = lat[i]!;
        const x = lng[i]!;
        if (!isValidPosition(y, x) || x < box[0] || x > box[2] || y < box[1] || y > box[3])
          continue;
      }
      rows.push(i);
    }
    const ids = this.state.str.vehicleId;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const keys = this.keys(sort.column, rows);
    const second = sort.column === 'location' ? this.lngKeys(rows) : null;
    const idx = rows.map((_, k) => k);
    if (typeof keys[0] === 'string' || keys.length === 0) {
      const s = keys as string[];
      idx.sort((a, b) => {
        const x = s[a]!;
        const y = s[b]!;
        // Empty values last in both directions.
        if (!x !== !y) return x ? -1 : 1;
        if (x !== y) return (x < y ? -1 : 1) * sign;
        return ids[rows[a]!]! < ids[rows[b]!]! ? -1 : 1;
      });
    } else {
      const v = keys as Float64Array;
      idx.sort((a, b) => {
        const x = v[a]!;
        const y = v[b]!;
        const xn = Number.isNaN(x);
        if (xn !== Number.isNaN(y)) return xn ? 1 : -1; // missing values last
        if (x !== y && !xn) return (x - y) * sign;
        if (second && !xn && second[a] !== second[b]) return (second[a]! - second[b]!) * sign;
        return ids[rows[a]!]! < ids[rows[b]!]! ? -1 : 1;
      });
    }
    return idx.map((k) => ids[rows[k]!]!);
  }

  private keys(column: TableColumnId, rows: number[]): string[] | Float64Array {
    const { cols, str, codes, dicts } = this.state;
    const n = rows.length;
    const numeric = (col: ArrayLike<number>, missing?: number) => {
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const v = col[rows[k]!]!;
        out[k] = v === missing ? NaN : v;
      }
      return out;
    };
    switch (column) {
      case 'regno':
      case 'vin':
      case 'deviceId':
        return rows.map((i) => str[column][i]!.toUpperCase());
      case 'fleet':
        return rows.map((i) => {
          const id = dicts.fleetId.values[codes.fleetId[i]!]!;
          return (this.fleetNames[id] ?? id).toUpperCase();
        });
      case 'status':
        // Display order of VEHICLE_STATUSES (code = index + 1; 0 = none → last).
        return numeric(cols.status ?? new Uint8Array(this.state.capacity), 0);
      case 'speed':
      case 'soc':
      case 'dte':
      case 'odometer':
      case 'gpstime':
      case 'canutctime':
        return numeric(cols[column]);
      case 'ignition':
        return numeric(cols.ignstatus, -1);
      case 'location': {
        // Latitude here; longitude breaks ties (`lngKeys`). No fix → missing.
        const out = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          const i = rows[k]!;
          out[k] = isValidPosition(cols.lat[i]!, cols.lng[i]!) ? cols.lat[i]! : NaN;
        }
        return out;
      }
    }
  }

  private lngKeys(rows: number[]): Float64Array {
    const lng = this.state.cols.lng;
    return Float64Array.from(rows, (i) => lng[i]!);
  }
}
