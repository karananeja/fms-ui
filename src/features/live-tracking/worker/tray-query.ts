import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { FleetState } from './fleet-state.ts';
import { isValidPosition } from './position.ts';
import { STATUS_CODE, statusOfCode } from './status-deriver.ts';
import type { Bbox } from './worker-api.ts';

/** Card fields for one vehicle in the tray (F09-R11). */
export interface TrayCard {
  vehicleId: string;
  regno: string;
  model: string;
  fleetId: string;
  assetType: string;
  status: VehicleStatus | null;
  speed: number | null;
  soc: number | null;
  dte: number | null;
}

export const TRAY_LIMIT = 24;

const num = (v: number) => (Number.isFinite(v) ? v : null);

/**
 * F09-R6: matching vehicles inside `bbox`, ordered by status priority (`priority`, highest
 * first), then most recently updated, then vehicle id. Keeps a bounded best-`limit` list.
 */
export function trayQuery(
  state: FleetState,
  matches: (i: number) => boolean,
  priority: readonly VehicleStatus[],
  bbox: Bbox,
  limit = TRAY_LIMIT,
): TrayCard[] {
  const rank = new Uint8Array(16).fill(255);
  priority.forEach((s, k) => (rank[STATUS_CODE[s]] = k));
  const { lat, lng, utctime } = state.cols;
  const status = state.cols.status;
  const ids = state.str.vehicleId;
  const [w, s, e, n] = bbox;
  /** Best rows so far, ascending by (rank, −utctime, id). */
  const best: number[] = [];
  const before = (a: number, b: number) => {
    const ra = rank[status?.[a] ?? 0]!;
    const rb = rank[status?.[b] ?? 0]!;
    if (ra !== rb) return ra < rb;
    const ta = utctime[a]!;
    const tb = utctime[b]!;
    if (ta !== tb) return Number.isNaN(tb) || ta > tb;
    return ids[a]! < ids[b]!;
  };
  for (let i = 0; i < state.count; i++) {
    const y = lat[i]!;
    const x = lng[i]!;
    if (y < s || y > n || x < w || x > e || !isValidPosition(y, x) || !matches(i)) continue;
    if (best.length === limit && !before(i, best[limit - 1]!)) continue;
    let k = best.length;
    while (k > 0 && before(i, best[k - 1]!)) k--;
    best.splice(k, 0, i);
    if (best.length > limit) best.pop();
  }
  const { codes, dicts, str } = state;
  return best.map((i) => ({
    vehicleId: ids[i]!,
    regno: str.regno[i]!,
    model: dicts.model.values[codes.model[i]!]!,
    fleetId: dicts.fleetId.values[codes.fleetId[i]!]!,
    assetType: dicts.assetType.values[codes.assetType[i]!]!,
    status: statusOfCode(status?.[i] ?? 0),
    speed: num(state.cols.speed[i]!),
    soc: num(state.cols.soc[i]!),
    dte: num(state.cols.dte[i]!),
  }));
}
