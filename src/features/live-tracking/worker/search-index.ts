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
  matchedField: Field;
}

interface Sorted {
  keys: string[];
  ids: string[];
}

/** First index whose key is ≥ `prefix`. */
const lowerBound = (keys: readonly string[], prefix: string) => {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]! < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * F08-R5: sorted, upper-cased key arrays per field with binary-search prefix lookup. Rebuilt
 * lazily on the next query after vehicles were added or removed.
 */
export class SearchIndex {
  /** Duration of the last rebuild / query (ms). */
  buildMs = 0;
  suggestMs = 0;
  private sorted: Record<Field, Sorted> | null = null;
  private builtCount = -1;

  constructor(private readonly state: FleetState) {
    const prev = state.hooks;
    state.hooks = {
      ...prev,
      beforeRemove: (i) => {
        prev.beforeRemove?.(i);
        this.sorted = null;
      },
    };
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
        for (let k = lowerBound(keys, p); k < keys.length && out.length < limit; k++) {
          if (!keys[k]!.startsWith(p)) break;
          const id = ids[k]!;
          if (seen.has(id)) continue;
          const i = this.state.byVehicle.get(id);
          if (i === undefined) continue;
          seen.add(id);
          out.push(this.toSuggestion(i, f));
        }
      }
    }
    this.suggestMs = performance.now() - t0;
    return out;
  }

  private toSuggestion(i: number, matchedField: Field): Suggestion {
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
    if (this.sorted && this.builtCount === this.state.count) return this.sorted;
    const t0 = performance.now();
    const n = this.state.count;
    const ids = this.state.str.vehicleId;
    const build = (f: Field): Sorted => {
      const raw = this.state.str[f];
      const upper = new Array<string>(n);
      for (let i = 0; i < n; i++) upper[i] = raw[i]!.toUpperCase();
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
        upper[a]! < upper[b]! ? -1 : upper[a]! > upper[b]! ? 1 : 0,
      );
      return { keys: order.map((i) => upper[i]!), ids: order.map((i) => ids[i]!) };
    };
    this.sorted = { regno: build('regno'), vin: build('vin'), deviceId: build('deviceId') };
    this.builtCount = n;
    this.buildMs = performance.now() - t0;
    return this.sorted;
  }
}
