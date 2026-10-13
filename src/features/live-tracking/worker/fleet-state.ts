import type { VehicleSummary } from './worker-api.ts';

type Column = Float64Array | Float32Array | Int8Array | Uint8Array | Uint16Array | Uint32Array;
type ColumnCtor = new (length: number) => Column;

const NUMERIC_COLUMNS = {
  lat: Float64Array,
  lng: Float64Array,
  utctime: Float64Array,
  gpstime: Float64Array,
  canutctime: Float64Array,
  lafparsedAt: Float64Array,
  speed: Float32Array,
  heading: Float32Array,
  soc: Float32Array,
  dte: Float32Array,
  odometer: Float32Array,
  carbattery: Float32Array,
  devbattery: Float32Array,
  ignstatus: Int8Array,
  fixquality: Int8Array,
  immobilization_status: Int8Array,
  /** Snapshot epoch in which the vehicle was last seen (reconciliation). */
  seen: Uint32Array,
} satisfies Record<string, ColumnCtor>;
type NumericColumn = keyof typeof NUMERIC_COLUMNS;

export const DICT_FIELDS = [
  'fleetId',
  'assetType',
  'fuelType',
  'make',
  'model',
  'variant',
] as const;
export const STRING_FIELDS = ['vehicleId', 'deviceId', 'regno', 'vin'] as const;
type DictField = (typeof DICT_FIELDS)[number];
type StringField = (typeof STRING_FIELDS)[number];

const DICT_SET = new Set<string>(DICT_FIELDS);
const STRING_SET = new Set<string>(STRING_FIELDS);
/** Rough V8 cost of one `Map` entry and one string beyond its characters. */
const MAP_ENTRY_BYTES = 40;
const STRING_OVERHEAD_BYTES = 24;
const PENDING_ROW_BYTES = 200;

/** Value stored for "no data": NaN for floats, -1 for signed ints, 0 otherwise. */
const missing = (c: Column) =>
  c instanceof Float64Array || c instanceof Float32Array ? NaN : c instanceof Int8Array ? -1 : 0;

export class StringDict {
  readonly values: string[] = [];
  private readonly ids = new Map<string, number>();

  id(value: string): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      if (this.values.length >= 0xffff) throw new Error('StringDict overflow');
      id = this.values.push(value) - 1;
      this.ids.set(value, id);
    }
    return id;
  }
}

type Op = 'str' | 'dict' | 'num';
interface CombPlan {
  vid: number;
  did: number;
  fleet: number;
  utc: number;
  ops: { k: number; op: Op; name: string }[];
}
interface LafPlan {
  did: number;
  can: number;
  pids: { k: number; name: string }[];
}

export interface FleetStateHooks {
  /** A row (combinfo or lafparsed) changed vehicle `i`. */
  rowChanged?(i: number): void;
  /** Vehicle `i` is about to be removed. */
  beforeRemove?(i: number): void;
}

export interface FleetStateOptions {
  pids: readonly string[];
  capacity?: number;
  pendingMax?: number;
  hooks?: FleetStateHooks;
}

/**
 * Struct-of-arrays fleet store: dense indices `0..count-1`, typed numeric columns,
 * dictionary-encoded low-cardinality strings, `string[]` for unique ids.
 */
export class FleetState {
  count = 0;
  capacity: number;
  /** Increments on every change. */
  version = 0;
  readonly cols = {} as Record<NumericColumn, Column> & Record<string, Column>;
  readonly pidCols: Record<string, Float32Array> = {};
  readonly codes = {} as Record<DictField, Uint16Array>;
  readonly dicts = {} as Record<DictField, StringDict>;
  readonly str = {} as Record<StringField, string[]>;
  readonly byVehicle = new Map<string, number>();
  readonly byDevice = new Map<string, number>();
  /** Latest lafparsed row per device not (yet) in the state. */
  readonly pending = new Map<string, { plan: LafPlan; row: unknown[] }>();
  pendingOpen = true;
  private epoch = 1;
  private stringBytes = 0;
  private readonly pendingMax: number;
  private readonly hooks: FleetStateHooks;
  private readonly plans = new Map<string, CombPlan | LafPlan>();

  constructor(private readonly opts: FleetStateOptions) {
    this.capacity = opts.capacity ?? 1024;
    this.pendingMax = opts.pendingMax ?? 20_000;
    this.hooks = opts.hooks ?? {};
    for (const [name, Ctor] of Object.entries(NUMERIC_COLUMNS)) this.addColumn<Column>(name, Ctor);
    for (const pid of opts.pids) this.pidCols[pid] = new Float32Array(this.capacity).fill(NaN);
    for (const f of DICT_FIELDS) {
      this.codes[f] = new Uint16Array(this.capacity);
      this.dicts[f] = new StringDict();
    }
    for (const f of STRING_FIELDS) this.str[f] = [];
  }

  /** Adds a typed column that grows and swap-removes with the rest (e.g. F05 `status`). */
  addColumn<C extends Column>(name: string, Ctor: new (length: number) => C): C {
    const col = new Ctor(this.capacity);
    col.fill(missing(col));
    this.cols[name] = col;
    return col;
  }

  get pids(): readonly string[] {
    return this.opts.pids;
  }

  // ---- combinfo ----

  /** Applies snapshot / delta rows of the fleet `combinfo` stream. Returns rows applied. */
  applyCombinfo(fields: readonly string[], rows: readonly unknown[][]): number {
    const p = this.combPlan(fields);
    if (p.vid < 0) return 0;
    let applied = 0;
    for (const row of rows) {
      const id = row[p.vid] as string;
      let i = this.byVehicle.get(id);
      if (p.fleet >= 0 && row[p.fleet] === null) {
        if (i !== undefined) {
          this.remove(i);
          applied++;
        }
        continue;
      }
      const inserted = i === undefined;
      if (i === undefined) {
        if (p.did < 0) continue;
        i = this.insert(id);
      } else {
        this.cols.seen[i] = this.epoch;
        if (p.utc >= 0 && (row[p.utc] as number) < this.cols.utctime[i]!) continue;
      }
      for (const { k, op, name } of p.ops) {
        const v = row[k];
        if (op === 'num') this.cols[name]![i] = typeof v === 'number' ? v : NaN;
        else if (op === 'dict')
          this.codes[name as DictField][i] = this.dicts[name as DictField].id(String(v));
        else this.setString(name as StringField, i, String(v));
      }
      this.version++;
      applied++;
      this.hooks.rowChanged?.(i);
      if (inserted) this.applyPending(i);
    }
    return applied;
  }

  // ---- lafparsed ----

  /** Applies fleet `lafparsed` rows, joined on `deviceId`. Returns rows applied. */
  applyLafparsed(fields: readonly string[], rows: readonly unknown[][]): number {
    const p = this.lafPlan(fields);
    if (p.did < 0) return 0;
    let applied = 0;
    for (const row of rows) {
      const did = row[p.did] as string;
      const i = this.byDevice.get(did);
      if (i === undefined) {
        if (this.pendingOpen) this.buffer(did, p, row);
      } else if (this.applyLafRow(i, p, row)) applied++;
    }
    return applied;
  }

  /** Stops buffering rows for unknown devices and drops the buffer. */
  closePending(): void {
    this.pending.clear();
    this.pendingOpen = false;
  }

  openPending(): void {
    this.pendingOpen = true;
  }

  // ---- reconciliation ----

  /** Starts a new snapshot: vehicles not seen until `endSnapshot` will be removed. */
  beginSnapshot(): void {
    this.epoch++;
  }

  /** Removes vehicles absent from the snapshot just completed. Returns how many. */
  endSnapshot(): number {
    let removed = 0;
    const seen = this.cols.seen;
    for (let i = this.count - 1; i >= 0; i--) {
      if (seen[i] !== this.epoch) {
        this.remove(i);
        removed++;
      }
    }
    return removed;
  }

  // ---- queries ----

  indexOf(vehicleId: string): number {
    return this.byVehicle.get(vehicleId) ?? -1;
  }

  summary(i: number): VehicleSummary {
    const c = this.cols;
    const d = (f: DictField) => this.dicts[f].values[this.codes[f][i]!]!;
    const pids: Record<string, number | null> = {};
    for (const pid of this.opts.pids) {
      const v = this.pidCols[pid]![i]!;
      pids[pid] = Number.isNaN(v) ? null : v;
    }
    return {
      vehicleId: this.str.vehicleId[i]!,
      deviceId: this.str.deviceId[i]!,
      regno: this.str.regno[i]!,
      vin: this.str.vin[i]!,
      fleetId: d('fleetId'),
      assetType: d('assetType'),
      fuelType: d('fuelType'),
      make: d('make'),
      model: d('model'),
      variant: d('variant'),
      lat: c.lat[i]!,
      lng: c.lng[i]!,
      speed: c.speed[i]!,
      heading: c.heading[i]!,
      soc: c.soc[i]!,
      dte: c.dte[i]!,
      odometer: c.odometer[i]!,
      carbattery: c.carbattery[i]!,
      devbattery: c.devbattery[i]!,
      ignstatus: c.ignstatus[i]!,
      fixquality: c.fixquality[i]!,
      immobilization_status: c.immobilization_status[i]!,
      utctime: c.utctime[i]!,
      gpstime: c.gpstime[i]!,
      canutctime: c.canutctime[i]!,
      lafparsedAt: c.lafparsedAt[i]!,
      pids,
    };
  }

  /** Estimated memory held by the state, in bytes. */
  get bytes(): number {
    let n = this.stringBytes + (this.byVehicle.size + this.byDevice.size) * MAP_ENTRY_BYTES;
    for (const c of this.allColumns()) n += c.byteLength;
    return n + this.pending.size * PENDING_ROW_BYTES;
  }

  // ---- internals ----

  private insert(vehicleId: string): number {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    for (const f of STRING_FIELDS) this.str[f].push('');
    for (const c of this.allColumns()) c[i] = missing(c);
    this.setString('vehicleId', i, vehicleId);
    this.byVehicle.set(vehicleId, i);
    this.cols.seen[i] = this.epoch;
    return i;
  }

  /** Swap-remove: the last vehicle moves into slot `i` so indices stay dense. */
  remove(i: number): void {
    this.hooks.beforeRemove?.(i);
    const last = this.count - 1;
    const vid = this.str.vehicleId[i]!;
    const did = this.str.deviceId[i]!;
    this.byVehicle.delete(vid);
    if (this.byDevice.get(did) === i) this.byDevice.delete(did);
    for (const f of STRING_FIELDS) {
      const s = this.str[f][i]!;
      if (s) this.stringBytes -= s.length + STRING_OVERHEAD_BYTES;
    }
    if (i !== last) {
      for (const c of this.allColumns()) c[i] = c[last]!;
      for (const f of STRING_FIELDS) this.str[f][i] = this.str[f][last]!;
      this.byVehicle.set(this.str.vehicleId[i]!, i);
      this.byDevice.set(this.str.deviceId[i]!, i);
    }
    for (const f of STRING_FIELDS) this.str[f].pop();
    this.count--;
    this.version++;
  }

  private setString(f: StringField, i: number, value: string): void {
    const col = this.str[f];
    const prev = col[i]!;
    if (prev === value) return;
    if (f === 'deviceId') {
      if (prev && this.byDevice.get(prev) === i) this.byDevice.delete(prev);
      this.byDevice.set(value, i);
    }
    this.stringBytes += value.length - prev.length + (prev ? 0 : STRING_OVERHEAD_BYTES);
    col[i] = value;
  }

  private applyLafRow(i: number, p: LafPlan, row: unknown[]): boolean {
    const t = row[p.can] as number;
    if (t < this.cols.lafparsedAt[i]!) return false;
    this.cols.lafparsedAt[i] = t;
    for (const { k, name } of p.pids) {
      const v = row[k];
      this.pidCols[name]![i] = typeof v === 'number' ? v : NaN;
    }
    this.version++;
    this.hooks.rowChanged?.(i);
    return true;
  }

  private applyPending(i: number): void {
    const entry = this.pending.get(this.str.deviceId[i]!);
    if (!entry) return;
    this.pending.delete(this.str.deviceId[i]!);
    this.applyLafRow(i, entry.plan, entry.row);
  }

  private buffer(did: string, plan: LafPlan, row: unknown[]): void {
    const prev = this.pending.get(did);
    if (prev && (prev.row[prev.plan.can] as number) > (row[plan.can] as number)) return;
    this.pending.delete(did);
    this.pending.set(did, { plan, row });
    if (this.pending.size > this.pendingMax) {
      this.pending.delete(this.pending.keys().next().value!);
    }
  }

  private *allColumns(): Generator<Column> {
    yield* Object.values(this.cols);
    yield* Object.values(this.pidCols);
    yield* Object.values(this.codes);
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const grown = <C extends Column>(c: C): C => {
      const next = new (c.constructor as new (n: number) => C)(cap);
      next.set(c as never);
      next.fill(missing(c), this.capacity);
      return next;
    };
    for (const k of Object.keys(this.cols)) this.cols[k] = grown(this.cols[k]!);
    for (const k of Object.keys(this.pidCols)) this.pidCols[k] = grown(this.pidCols[k]!);
    for (const f of DICT_FIELDS) this.codes[f] = grown(this.codes[f]);
    this.capacity = cap;
  }

  private combPlan(fields: readonly string[]): CombPlan {
    const key = `c:${fields.join(',')}`;
    let plan = this.plans.get(key) as CombPlan | undefined;
    if (!plan) {
      plan = {
        vid: fields.indexOf('vehicleId'),
        did: fields.indexOf('deviceId'),
        fleet: fields.indexOf('fleetId'),
        utc: fields.indexOf('utctime'),
        ops: [],
      };
      fields.forEach((name, k) => {
        if (name === 'vehicleId') return;
        if (STRING_SET.has(name)) plan!.ops.push({ k, op: 'str', name });
        else if (DICT_SET.has(name)) plan!.ops.push({ k, op: 'dict', name });
        else if (name in NUMERIC_COLUMNS) plan!.ops.push({ k, op: 'num', name });
      });
      this.plans.set(key, plan);
    }
    return plan;
  }

  private lafPlan(fields: readonly string[]): LafPlan {
    const key = `l:${fields.join(',')}`;
    let plan = this.plans.get(key) as LafPlan | undefined;
    if (!plan) {
      plan = {
        did: fields.indexOf('deviceId'),
        can: fields.indexOf('canutctime'),
        pids: fields.flatMap((name, k) => (name in this.pidCols ? [{ k, name }] : [])),
      };
      this.plans.set(key, plan);
    }
    return plan;
  }
}
