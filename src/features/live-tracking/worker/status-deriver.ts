import {
  isVehicleStatus,
  VEHICLE_STATUSES,
  type VehicleStatus,
} from '@shared/domain/vehicle-status.ts';
import { statusRulesConfig, type StatusRulesConfig } from '../config/status-rules-config.ts';
import type { FleetState, FleetStateHooks } from './fleet-state.ts';
import type { VehicleSummary } from './worker-api.ts';

/** Status code stored in the `status` column: index in `VEHICLE_STATUSES` + 1 (0 = none yet). */
export const STATUS_CODE = Object.fromEntries(VEHICLE_STATUSES.map((s, k) => [s, k + 1])) as Record<
  VehicleStatus,
  number
>;
export const statusOfCode = (code: number): VehicleStatus | null =>
  VEHICLE_STATUSES[code - 1] ?? null;
/** Encodes a server `displayStatus`: a valid status → its code, anything else → 0. */
export const encodeStatus = (v: unknown): number => (isVehicleStatus(v) ? STATUS_CODE[v] : 0);

type Col = ArrayLike<number>;
type Test = (i: number, now: number) => boolean;
/** Returns the status code of vehicle `i` at `now`. */
export type Evaluate = (i: number, now: number) => number;

const RULES: Record<VehicleStatus, (cfg: StatusRulesConfig, col: (f: string) => Col) => Test> = {
  'gps-never': (_, col) => {
    const lat = col('lat');
    const lng = col('lng');
    return (i) => {
      const a = lat[i]!;
      const b = lng[i]!;
      return (a === 0 && b === 0) || a !== a || b !== b;
    };
  },
  'non-comm': (cfg, col) => {
    const t = col('utctime');
    const ms = cfg.thresholds.nonCommMs;
    return (i, now) => now - t[i]! > ms;
  },
  pullout: (cfg, col) => {
    const v = col('carbattery');
    const volts = cfg.thresholds.pulloutVolts;
    return (i) => v[i]! < volts;
  },
  immobilized: (cfg, col) => {
    const v = col(cfg.immobilized.field);
    const eq = cfg.immobilized.equals;
    return (i) => v[i] === eq;
  },
  charging: (cfg, col) => {
    const tests = cfg.charging.anyOf.map((c): ((i: number) => boolean) => {
      const v = col(c.pid);
      if ('equals' in c) return (i) => v[i] === c.equals;
      const ne = c.notEquals;
      return (i) => {
        const x = v[i]!;
        return x === x && x !== ne;
      };
    });
    const n = tests.length;
    return (i) => {
      for (let k = 0; k < n; k++) if (tests[k]!(i)) return true;
      return false;
    };
  },
  'no-gps': (cfg, col) => {
    const t = col('gpstime');
    const ms = cfg.thresholds.noGpsMs;
    return (i, now) => now - t[i]! > ms;
  },
  running: (cfg, col) => {
    const ign = col('ignstatus');
    const speed = col('speed');
    const kmh = cfg.thresholds.runningSpeedKmh;
    return (i) => ign[i] === 1 && speed[i]! > kmh;
  },
  stopped: () => () => true,
};

/** Compiles the rules (in `cfg.priority` order, first match wins) against column lookups. */
export function compileStatusRules(
  cfg: StatusRulesConfig,
  resolve: (field: string) => Col | undefined,
): Evaluate {
  const col = (f: string) => {
    const c = resolve(f);
    if (!c) throw new Error(`Status rules reference unknown field "${f}"`);
    return c;
  };
  const tests = cfg.priority.map((s) => RULES[s](cfg, col));
  const codes = cfg.priority.map((s) => STATUS_CODE[s]);
  const server = cfg.preferServerStatus ? resolve('displayStatus') : undefined;
  const n = tests.length;
  const stopped = STATUS_CODE.stopped;
  return (i, now) => {
    if (server && server[i]! > 0) return server[i]!;
    for (let r = 0; r < n; r++) if (tests[r]!(i, now)) return codes[r]!;
    return stopped;
  };
}

/** One vehicle's fields; lafparsed PIDs may sit under `pids`. Missing / null / non-number = no data. */
export type StatusInput = Record<string, unknown> & { pids?: Record<string, number | null> };

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);

/** Pure single-vehicle evaluation (same rules as the sweep). */
export function deriveStatus(
  v: StatusInput | VehicleSummary,
  now: number,
  cfg: StatusRulesConfig = statusRulesConfig,
): VehicleStatus {
  const fields = v as StatusInput;
  const evaluate = compileStatusRules(cfg, (f) =>
    f === 'displayStatus' ? [encodeStatus(fields[f])] : [num(fields[f] ?? v.pids?.[f])],
  );
  return statusOfCode(evaluate(0, now))!;
}

/**
 * Keeps a `status` column and per-status counts on a `FleetState`: re-evaluates a vehicle on
 * every applied row (at `now`), adjusts counts on removal, and re-evaluates all in `sweep`.
 */
export class StatusTracker implements FleetStateHooks {
  /** Indexed by status code; slot 0 (none) stays 0. */
  readonly counts = new Uint32Array(VEHICLE_STATUSES.length + 1);
  /** Server-corrected time used for row updates; set by the engine before applying rows. */
  now = 0;
  private evaluate: Evaluate = () => 0;
  private compiledFor = -1;

  constructor(
    private readonly state: FleetState,
    private readonly cfg: StatusRulesConfig,
  ) {
    state.addColumn('status', Uint8Array);
    state.addColumn('displayStatus', Uint8Array, encodeStatus);
    state.hooks = this;
    this.compiled();
  }

  get total(): number {
    return this.state.count;
  }

  statusOf(i: number): VehicleStatus | null {
    return statusOfCode(this.state.cols.status![i]!);
  }

  statusCounts(): Record<VehicleStatus, number> {
    const out = {} as Record<VehicleStatus, number>;
    for (const s of VEHICLE_STATUSES) out[s] = this.counts[STATUS_CODE[s]]!;
    return out;
  }

  rowChanged(i: number): void {
    const st = this.state.cols.status!;
    const next = this.compiled()(i, this.now);
    const prev = st[i]!;
    if (next === prev) return;
    if (prev) this.counts[prev]!--;
    this.counts[next]!++;
    st[i] = next;
  }

  beforeRemove(i: number): void {
    const prev = this.state.cols.status![i]!;
    if (prev) this.counts[prev]!--;
  }

  /** Re-evaluates every vehicle at `now`. Returns how many changed status. */
  sweep(now: number): number {
    this.now = now;
    const evaluate = this.compiled();
    const st = this.state.cols.status!;
    const counts = this.counts;
    const n = this.state.count;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const next = evaluate(i, now);
      const prev = st[i]!;
      if (next !== prev) {
        if (prev) counts[prev]!--;
        counts[next]!++;
        st[i] = next;
        changed++;
      }
    }
    return changed;
  }

  /** Columns are reallocated when the state grows, so recompile per capacity. */
  private compiled(): Evaluate {
    if (this.compiledFor !== this.state.capacity) {
      const { cols, pidCols } = this.state;
      this.evaluate = compileStatusRules(this.cfg, (f) => cols[f] ?? pidCols[f]);
      this.compiledFor = this.state.capacity;
    }
    return this.evaluate;
  }
}
