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
/** Returns the status code of vehicle `i` at `now`. */
export type Evaluate = (i: number, now: number) => number;

const {
  running: RUNNING,
  stopped: STOPPED,
  immobilized: IMMOBILIZED,
  'non-comm': NON_COMM,
  charging: CHARGING,
  pullout: PULLOUT,
  'no-gps': NO_GPS,
  'gps-never': GPS_NEVER,
} = STATUS_CODE;

/**
 * Compiles the rules (in `cfg.priority` order, first match wins) against column lookups.
 * One switch over status codes keeps the hot sweep loop monomorphic.
 */
export function compileStatusRules(
  cfg: StatusRulesConfig,
  resolve: (field: string) => Col | undefined,
): Evaluate {
  const col = (f: string) => {
    const c = resolve(f);
    if (!c) throw new Error(`Status rules reference unknown field "${f}"`);
    return c;
  };
  const [lat, lng, utc, gps, battery, ign, speed] = [
    'lat',
    'lng',
    'utctime',
    'gpstime',
    'carbattery',
    'ignstatus',
    'speed',
  ].map(col) as [Col, Col, Col, Col, Col, Col, Col];
  const immo = col(cfg.immobilized.field);
  const immoEq = cfg.immobilized.equals;
  const { nonCommMs, noGpsMs, pulloutVolts, runningSpeedKmh } = cfg.thresholds;
  const charge = cfg.charging.anyOf.map((c) => col(c.pid));
  const chargeValue = cfg.charging.anyOf.map((c) => ('equals' in c ? c.equals : c.notEquals));
  const chargeNot = cfg.charging.anyOf.map((c) => !('equals' in c));
  const nCharge = charge.length;
  const order = Uint8Array.from(cfg.priority, (s) => STATUS_CODE[s]);
  const nOrder = order.length;
  const server = cfg.preferServerStatus ? resolve('displayStatus') : undefined;

  const charging = (i: number) => {
    for (let k = 0; k < nCharge; k++) {
      const x = charge[k]![i]!;
      if (chargeNot[k] ? x === x && x !== chargeValue[k] : x === chargeValue[k]) return true;
    }
    return false;
  };
  const matches = (code: number, i: number, now: number): boolean => {
    switch (code) {
      case GPS_NEVER: {
        const a = lat[i]!;
        const b = lng[i]!;
        return (a === 0 && b === 0) || a !== a || b !== b;
      }
      case NON_COMM:
        return now - utc[i]! > nonCommMs;
      case PULLOUT:
        return battery[i]! < pulloutVolts;
      case IMMOBILIZED:
        return immo[i] === immoEq;
      case CHARGING:
        return charging(i);
      case NO_GPS:
        return now - gps[i]! > noGpsMs;
      case RUNNING:
        return ign[i] === 1 && speed[i]! > runningSpeedKmh;
      default:
        return true;
    }
  };
  return (i, now) => {
    if (server && server[i]! > 0) return server[i]!;
    for (let r = 0; r < nOrder; r++) if (matches(order[r]!, i, now)) return order[r]!;
    return STOPPED;
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
