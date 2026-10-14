import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { SEARCH_FIELDS, type SearchField } from './filter-engine.ts';
import type { FleetState } from './fleet-state.ts';
import { statusOfCode } from './status-deriver.ts';

type Field = (typeof SEARCH_FIELDS)[number];

export interface Suggestion {
  vehicleId: string;
  regno: string;
  vin: string;
  deviceId: string;
  status: VehicleStatus | null;
  /** `driver`: matched by the current driver's name (F12-R6). */
  matchedField: Field | 'driver';
  /** F12-R6: the current driver's name, on driver matches. */
  driverName?: string;
}

interface Sorted {
  keys: string[];
  ids: string[];
}

/** After this many incremental edits a full rebuild is cheaper than more array splices. */
const MAX_EDITS = 1000;

/** First index whose key is ≥ `prefix` (`strict`: > `prefix`). */
const bound = (keys: readonly string[], prefix: string, strict = false) => {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]! < prefix || (strict && keys[mid] === prefix)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * F08-R5: sorted, upper-cased key arrays per field with binary-search prefix lookup.
 *
 * Built once (`warm()` when the snapshot completes, else on the first query), then kept current:
 * added, removed and re-identified vehicles are spliced in and out, so a query never waits for a
 * full rebuild (~75 ms at 1 lakh). Bulk churn (> `MAX_EDITS`) drops the index; it is rebuilt in a
 * task of its own via `schedule` (the engine's timer), else lazily on the next query.
 */
export class SearchIndex {
  /** Duration of the last full build / query (ms). */
  buildMs = 0;
  suggestMs = 0;
  builds = 0;
  private sorted: Record<Field, Sorted> | null = null;
  /** Per-row identifiers as indexed (mirrors the state's swap-remove), to spot changes cheaply. */
  private raw: Record<Field, string[]> = { regno: [], vin: [], deviceId: [] };
  private edits = 0;
  private rebuildQueued = false;

  constructor(
    private readonly state: FleetState,
    private readonly schedule?: (task: () => void) => void,
  ) {
    state.addHooks({
      rowChanged: (i) => this.rowChanged(i),
      beforeRemove: (i) => this.beforeRemove(i),
    });
  }

  /** Builds the index now if it isn't (call when the worker is otherwise idle). */
  warm(): void {
    this.ensure();
  }

  suggest(prefix: string, field: SearchField, limit = 8): Suggestion[] {
    const t0 = performance.now();
    const p = prefix.trim().toUpperCase();
    const out: Suggestion[] = [];
    if (p && limit > 0) {
      const index = this.ensure();
      const seen = new Set<string>();
      for (const f of field === 'all' ? SEARCH_FIELDS : [field]) {
        const { keys, ids } = index[f];
        for (let k = bound(keys, p); k < keys.length && out.length < limit; k++) {
          if (!keys[k]!.startsWith(p)) break;
          const id = ids[k]!;
          if (seen.has(id)) continue;
          const i = this.state.byVehicle.get(id);
          if (i === undefined) continue;
          seen.add(id);
          out.push(this.suggestionAt(i, f));
        }
      }
    }
    this.suggestMs = performance.now() - t0;
    return out;
  }

  private rowChanged(i: number): void {
    if (!this.sorted) return;
    const { str } = this.state;
    const id = str.vehicleId[i]!;
    const tracked = this.raw.regno.length;
    if (i === tracked) {
      for (const f of SEARCH_FIELDS) {
        this.raw[f].push(str[f][i]!);
        this.insert(f, str[f][i]!, id);
      }
      return;
    }
    if (i > tracked) return this.drop();
    for (const f of SEARCH_FIELDS) {
      const prev = this.raw[f][i]!;
      const next = str[f][i]!;
      if (prev === next) continue;
      this.remove(f, prev, id);
      this.insert(f, next, id);
      this.raw[f][i] = next;
    }
  }

  private beforeRemove(i: number): void {
    if (!this.sorted) return;
    const id = this.state.str.vehicleId[i]!;
    for (const f of SEARCH_FIELDS) {
      const raw = this.raw[f];
      this.remove(f, raw[i]!, id);
      raw[i] = raw[raw.length - 1]!;
      raw.pop();
    }
  }

  private insert(f: Field, value: string, id: string): void {
    if (++this.edits > MAX_EDITS) return this.drop();
    const { keys, ids } = this.sorted![f];
    const key = value.toUpperCase();
    const k = bound(keys, key, true);
    keys.splice(k, 0, key);
    ids.splice(k, 0, id);
  }

  private remove(f: Field, value: string, id: string): void {
    if (++this.edits > MAX_EDITS) return this.drop();
    const { keys, ids } = this.sorted![f];
    const key = value.toUpperCase();
    for (let k = bound(keys, key); k < keys.length && keys[k] === key; k++) {
      if (ids[k] !== id) continue;
      keys.splice(k, 1);
      ids.splice(k, 1);
      return;
    }
  }

  private drop(): void {
    this.sorted = null;
    if (!this.schedule || this.rebuildQueued) return;
    this.rebuildQueued = true;
    this.schedule(() => {
      this.rebuildQueued = false;
      this.ensure();
    });
  }

  /** The suggestion for row `i` (also used by the F12 driver search). */
  suggestionAt(i: number, matchedField: Suggestion['matchedField']): Suggestion {
    const { vehicleId, regno, vin, deviceId } = this.state.str;
    return {
      vehicleId: vehicleId[i]!,
      regno: regno[i]!,
      vin: vin[i]!,
      deviceId: deviceId[i]!,
      status: statusOfCode(this.state.cols.status?.[i] ?? 0),
      matchedField,
    };
  }

  private ensure(): Record<Field, Sorted> {
    if (this.sorted) return this.sorted;
    const t0 = performance.now();
    const n = this.state.count;
    const ids = this.state.str.vehicleId;
    // `key \u0001 row` strings sort with the engine's native string order (no JS comparator);
    // \u0001 sorts below any identifier character.
    const build = (f: Field): Sorted => {
      const raw = this.state.str[f];
      const tagged = new Array<string>(n);
      for (let i = 0; i < n; i++) tagged[i] = `${raw[i]!.toUpperCase()}\u0001${i}`;
      tagged.sort();
      const keys = new Array<string>(n);
      const out = new Array<string>(n);
      for (let k = 0; k < n; k++) {
        const t = tagged[k]!;
        const cut = t.lastIndexOf('\u0001');
        keys[k] = t.slice(0, cut);
        out[k] = ids[+t.slice(cut + 1)]!;
      }
      return { keys, ids: out };
    };
    this.sorted = { regno: build('regno'), vin: build('vin'), deviceId: build('deviceId') };
    const { regno, vin, deviceId } = this.state.str;
    this.raw = { regno: regno.slice(0, n), vin: vin.slice(0, n), deviceId: deviceId.slice(0, n) };
    this.edits = 0;
    this.builds++;
    this.buildMs = performance.now() - t0;
    return this.sorted;
  }
}
