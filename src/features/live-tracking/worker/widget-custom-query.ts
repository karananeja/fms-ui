import { MAP_POINTS_MAX, type CustomFilter, type CustomShape } from '@shared/contract/widget-grammar.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import {
  applyShape,
  compileFilter,
  type Cell,
  type ShapeGroup,
  type ShapeOptions,
  type ShapeTable,
} from '@shared/domain/widget-shape.ts';
import type { FleetState } from './fleet-state.ts';
import { isValidPosition } from './position.ts';

/** F26: a `custom` widget over the live fleet (dataset `live-vehicles`). */
export interface LiveCustomQuery {
  kind: 'custom';
  filter?: CustomFilter;
  shape?: CustomShape;
  /** Fields returned per row (ungrouped); `vehicleId` and `regno` are always added. */
  columns?: string[];
  /** Map points instead of rows: colour / label / size fields and a cap (≤ MAP_POINTS_MAX). */
  points?: { color?: string; label?: string; size?: string; max?: number };
}

/** Parallel arrays (structured-clone friendly). */
export interface LivePoints {
  ids: string[];
  regnos: string[];
  lng: number[];
  lat: number[];
  heading: number[];
  color: Cell[];
  label: Cell[];
  size: Cell[];
}

export interface LiveCustomResult {
  kind: 'custom';
  /** Vehicles matching the filter (with a valid position, for points). */
  total: number;
  value: number | null;
  groups: ShapeGroup[] | null;
  rows: Record<string, Cell>[] | null;
  points: LivePoints | null;
}

const num = (c: ArrayLike<number>) => (i: number) => {
  const v = c[i]!;
  return v === v ? v : null;
};

/** Column accessors of the grammar's `live-vehicles` fields over the fleet state. */
export function liveTable(state: FleetState): ShapeTable {
  const { cols, codes, dicts, str } = state;
  const dict = (f: 'fleetId' | 'make' | 'model' | 'assetType' | 'fuelType') => {
    const values = dicts[f].values;
    const c = codes[f];
    return (i: number) => values[c[i]!] ?? null;
  };
  const accessors: Record<string, (i: number) => Cell> = {
    vehicleId: (i) => str.vehicleId[i] ?? null,
    regno: (i) => str.regno[i] ?? null,
    fleet: dict('fleetId'),
    status: (i) => VEHICLE_STATUSES[(cols.status?.[i] ?? 0) - 1] ?? null,
    make: dict('make'),
    model: dict('model'),
    assetType: dict('assetType'),
    fuelType: dict('fuelType'),
    ignition: (i) => (cols.ignstatus[i] === 1 ? 'on' : cols.ignstatus[i] === 0 ? 'off' : null),
    speed: num(cols.speed),
    soc: num(cols.soc),
    dte: num(cols.dte),
    odometer: num(cols.odometer),
    heading: num(cols.heading),
    gpstime: (i) => (cols.gpstime[i]! > 0 ? cols.gpstime[i]! : null),
    lat: (i) => (isValidPosition(cols.lat[i]!, cols.lng[i]!) ? cols.lat[i]! : null),
    lng: (i) => (isValidPosition(cols.lat[i]!, cols.lng[i]!) ? cols.lng[i]! : null),
  };
  return {
    count: state.count,
    col: (f) => accessors[f] ?? (() => null),
  };
}

/** Runs one custom query (its own predicate; never the global filter, viewport or selection). */
export function runLiveCustom(
  state: FleetState,
  q: LiveCustomQuery,
  expandFleets: (ids: string[]) => string[],
): LiveCustomResult {
  const table = liveTable(state);
  const opts: ShapeOptions = {
    timeField: 'gpstime',
    expand: (field, values) =>
      field === 'fleet' ? expandFleets(values.map(String)) : values,
  };
  if (q.points) {
    const test = compileFilter(table, q.filter, opts);
    const max = Math.max(0, Math.min(q.points.max ?? MAP_POINTS_MAX, MAP_POINTS_MAX));
    const color = q.points.color ? table.col(q.points.color) : null;
    const label = table.col(q.points.label ?? 'regno');
    const size = q.points.size ? table.col(q.points.size) : null;
    const { lat, lng, heading } = state.cols;
    const out: LivePoints = {
      ids: [],
      regnos: [],
      lng: [],
      lat: [],
      heading: [],
      color: [],
      label: [],
      size: [],
    };
    let total = 0;
    for (let i = 0; i < state.count; i++) {
      if (!isValidPosition(lat[i]!, lng[i]!)) continue;
      if (test && !test(i)) continue;
      total++;
      if (out.ids.length >= max) continue;
      out.ids.push(state.str.vehicleId[i]!);
      out.regnos.push(state.str.regno[i]!);
      out.lng.push(lng[i]!);
      out.lat.push(lat[i]!);
      out.heading.push(heading[i]! === heading[i]! ? heading[i]! : 0);
      out.color.push(color ? color(i) : null);
      out.label.push(label(i));
      out.size.push(size ? size(i) : null);
    }
    return { kind: 'custom', total, value: null, groups: null, rows: null, points: out };
  }
  const r = applyShape(table, q, opts);
  let rows: Record<string, Cell>[] | null = null;
  if (r.rows) {
    const fields = [...new Set(['vehicleId', 'regno', ...(q.columns ?? [])])];
    const getters = fields.map((f) => [f, table.col(f)] as const);
    rows = r.rows.map((i) => Object.fromEntries(getters.map(([f, g]) => [f, g(i)])));
  }
  return { kind: 'custom', total: r.total, value: r.value, groups: r.groups, rows, points: null };
}
