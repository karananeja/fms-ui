import type {
  AggregateOp,
  CustomFilter,
  CustomShape,
  TimeBucket,
} from '../contract/widget-grammar.ts';
import { CUSTOM_GROUPS_MAX, CUSTOM_ROWS_MAX } from '../contract/widget-grammar.ts';

/**
 * F26 (D-144): the one shaping core of the widget grammar — filter → group / time bucket →
 * aggregate → sort → limit — over any column source. The worker runs it on the fleet state's
 * columns (1 lakh rows, no row objects); the client runs it on REST rows.
 */

export type Cell = string | number | null;

export interface ShapeTable {
  count: number;
  /** Column accessor; `null` = missing. Called once per query per field. */
  col(field: string): (i: number) => Cell;
}

export interface ShapeOptions {
  /** Expands condition values of a field before matching (e.g. a fleet → its subtree). */
  expand?: (field: string, values: (string | number)[]) => (string | number)[];
  /** The dataset's time field (for `timeBucket`). */
  timeField?: string;
  /** Default row limit when the shape has none. */
  rowLimit?: number;
}

export interface ShapeGroup {
  key: string | null;
  /** Bucket start (epoch ms, IST-aligned), or null without `timeBucket`. */
  bucket: number | null;
  value: number | null;
  count: number;
}

export interface ShapeResult {
  /** Rows matching the filter. */
  total: number;
  /** Single aggregate (no groupBy/timeBucket). */
  value: number | null;
  /** Grouped results (groupBy and/or timeBucket). */
  groups: ShapeGroup[] | null;
  /** Row indices after sort + limit (ungrouped). */
  rows: number[] | null;
}

const IST = 330 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 1970-01-01 was a Thursday: shift so weeks start on Monday (IST). */
const WEEK_SHIFT = 3 * DAY;

/** Start of the IST hour / day / week (Monday) holding `t`. */
export function bucketStart(t: number, bucket: TimeBucket): number {
  if (bucket === 'hour') return Math.floor((t + IST) / HOUR) * HOUR - IST;
  if (bucket === 'day') return Math.floor((t + IST) / DAY) * DAY - IST;
  return Math.floor((t + IST + WEEK_SHIFT) / (7 * DAY)) * 7 * DAY - IST - WEEK_SHIFT;
}

const BUCKET_MS: Record<TimeBucket, number> = { hour: HOUR, day: DAY, week: 7 * DAY };

type Test = (i: number) => boolean;

function compileCondition(
  table: ShapeTable,
  c: { field: string; op: string; value: string | number | (string | number)[] },
  opts: ShapeOptions,
): Test {
  const get = table.col(c.field);
  const raw = Array.isArray(c.value) ? c.value : [c.value];
  const values = opts.expand ? opts.expand(c.field, raw) : raw;
  const lower = (v: Cell) => (typeof v === 'string' ? v.toLowerCase() : v);
  const set = new Set(values.map(lower));
  const one = lower(raw[0]!);
  switch (c.op) {
    case 'eq':
    case 'in':
      return (i) => set.has(lower(get(i)));
    case 'ne':
    case 'nin':
      return (i) => !set.has(lower(get(i)));
    case 'contains': {
      const needle = String(one);
      return (i) => {
        const v = get(i);
        return typeof v === 'string' && v.toLowerCase().includes(needle);
      };
    }
    default: {
      const n = Number(one);
      const cmp =
        c.op === 'lt'
          ? (v: number) => v < n
          : c.op === 'lte'
            ? (v: number) => v <= n
            : c.op === 'gt'
              ? (v: number) => v > n
              : (v: number) => v >= n;
      return (i) => {
        const v = get(i);
        return typeof v === 'number' && v === v && cmp(v);
      };
    }
  }
}

/** `all` AND, then ≥ 1 of `any`; null = every row. */
export function compileFilter(
  table: ShapeTable,
  filter: CustomFilter | undefined,
  opts: ShapeOptions = {},
): Test | null {
  const all = (filter?.all ?? []).map((c) => compileCondition(table, c, opts));
  const any = (filter?.any ?? []).map((c) => compileCondition(table, c, opts));
  if (!all.length && !any.length) return null;
  return (i) => {
    for (let k = 0; k < all.length; k++) if (!all[k]!(i)) return false;
    if (!any.length) return true;
    for (let k = 0; k < any.length; k++) if (any[k]!(i)) return true;
    return false;
  };
}

const missing = (v: Cell) => v === null || v === '' || (typeof v === 'number' && v !== v);

/** Ascending compare with missing values last (in both directions, like F09). */
function compareCells(a: Cell, b: Cell, sign: number): number {
  const am = missing(a);
  const bm = missing(b);
  if (am !== bm) return am ? 1 : -1;
  if (am || a === b) return 0;
  if (typeof a === 'string' && typeof b === 'string')
    return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) * sign;
  return ((a as number) < (b as number) ? -1 : 1) * sign;
}

interface Acc {
  key: string | null;
  bucket: number | null;
  count: number;
  n: number;
  sum: number;
  min: number;
  max: number;
}

function valueOf(acc: Acc, op: AggregateOp, hasField: boolean): number | null {
  switch (op) {
    case 'count':
      return hasField ? acc.n : acc.count;
    case 'sum':
      return acc.n ? acc.sum : 0;
    case 'avg':
      return acc.n ? acc.sum / acc.n : null;
    case 'min':
      return acc.n ? acc.min : null;
    case 'max':
      return acc.n ? acc.max : null;
  }
}

/** Runs filter → group → aggregate → sort → limit over `table`. */
export function applyShape(
  table: ShapeTable,
  q: { filter?: CustomFilter; shape?: CustomShape },
  opts: ShapeOptions = {},
): ShapeResult {
  const shape = q.shape ?? {};
  const test = compileFilter(table, q.filter, opts);
  const n = table.count;
  const grouped = !!(shape.groupBy || shape.timeBucket);

  if (!grouped && !shape.aggregate) {
    const limit = Math.min(shape.limit ?? opts.rowLimit ?? CUSTOM_ROWS_MAX, CUSTOM_ROWS_MAX);
    const sortBy = shape.sort && shape.sort.by !== 'value' ? table.col(shape.sort.by) : null;
    const sign = shape.sort?.dir === 'desc' ? -1 : 1;
    const rows: number[] = [];
    const keys: Cell[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (test && !test(i)) continue;
      total++;
      if (!sortBy) {
        if (rows.length < limit) rows.push(i);
        continue;
      }
      // Bounded top-K by binary insertion (stable by row order).
      const key = sortBy(i);
      const len = rows.length;
      if (len === limit && compareCells(key, keys[len - 1]!, sign) >= 0) continue;
      let lo = 0;
      let hi = len;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (compareCells(keys[mid]!, key, sign) <= 0) lo = mid + 1;
        else hi = mid;
      }
      rows.splice(lo, 0, i);
      keys.splice(lo, 0, key);
      if (rows.length > limit) {
        rows.pop();
        keys.pop();
      }
    }
    return { total, value: null, groups: null, rows };
  }

  const agg = shape.aggregate ?? { op: 'count' as const };
  const field = agg.field ? table.col(agg.field) : null;
  const keyOf = shape.groupBy ? table.col(shape.groupBy) : null;
  const timeOf = shape.timeBucket && opts.timeField ? table.col(opts.timeField) : null;
  const bucket = shape.timeBucket;
  const accs = new Map<string | number | null, Acc>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (test && !test(i)) continue;
    total++;
    const rawKey = keyOf ? keyOf(i) : null;
    const key = rawKey === null || rawKey === '' ? null : String(rawKey);
    let b: number | null = null;
    if (timeOf) {
      const t = timeOf(i);
      if (typeof t !== 'number' || t !== t) continue;
      b = bucketStart(t, bucket!);
    }
    const mapKey = keyOf && timeOf ? `${key}\u0001${b}` : keyOf ? key : b;
    let acc = accs.get(mapKey);
    if (!acc) {
      acc = { key, bucket: b, count: 0, n: 0, sum: 0, min: Infinity, max: -Infinity };
      accs.set(mapKey, acc);
    }
    acc.count++;
    if (field) {
      const v = field(i);
      if (typeof v === 'number' && v === v) {
        acc.n++;
        acc.sum += v;
        if (v < acc.min) acc.min = v;
        if (v > acc.max) acc.max = v;
      }
    }
  }
  const hasField = !!agg.field;

  if (!grouped) {
    const all = accs.get(null) ?? {
      key: null,
      bucket: null,
      count: 0,
      n: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
    };
    return { total, value: valueOf(all, agg.op, hasField), groups: null, rows: null };
  }

  let groups: ShapeGroup[] = [...accs.values()].map((a) => ({
    key: a.key,
    bucket: a.bucket,
    value: valueOf(a, agg.op, hasField),
    count: a.count,
  }));

  if (bucket && !keyOf && groups.length) {
    // Fill empty buckets between the first and last one (a gap reads as zero, not a jump).
    const step = BUCKET_MS[bucket];
    const have = new Map(groups.map((g) => [g.bucket!, g]));
    const first = Math.min(...have.keys());
    const last = Math.max(...have.keys());
    if ((last - first) / step <= 400 && bucket !== 'week') {
      groups = [];
      // IST has no DST: hours and days are fixed lengths.
      for (let t = first; t <= last; t += step) {
        const zero = agg.op === 'count' || agg.op === 'sum' ? 0 : null;
        groups.push(have.get(t) ?? { key: null, bucket: t, value: zero, count: 0 });
      }
    }
  }

  const sign = shape.sort?.dir === 'asc' ? 1 : -1;
  const byValue = (a: ShapeGroup, b: ShapeGroup) =>
    compareCells(a.value, b.value, shape.sort ? sign : -1) ||
    compareCells(a.key, b.key, 1);
  if (bucket && !keyOf) {
    groups.sort((a, b) =>
      shape.sort?.by === 'value' ? byValue(a, b) : (a.bucket! - b.bucket!) * (shape.sort?.dir === 'desc' ? -1 : 1),
    );
    const limit = Math.min(shape.limit ?? CUSTOM_ROWS_MAX, CUSTOM_ROWS_MAX);
    // Keep the latest buckets when there are more than the limit.
    if (groups.length > limit) groups = shape.sort ? groups.slice(0, limit) : groups.slice(-limit);
    return { total, value: null, groups, rows: null };
  }

  const keyLimit = Math.min(shape.limit ?? 12, CUSTOM_GROUPS_MAX);
  if (!bucket) {
    if (shape.sort && shape.sort.by !== 'value')
      groups.sort((a, b) => compareCells(a.key, b.key, sign) || 0);
    else groups.sort(byValue);
    return { total, value: null, groups: groups.slice(0, keyLimit), rows: null };
  }

  // 2-D: keep the top keys by their total, buckets ascending.
  const totals = new Map<string | null, number>();
  for (const g of groups) totals.set(g.key, (totals.get(g.key) ?? 0) + (g.value ?? 0));
  const keys = [...totals.entries()]
    .sort((a, b) => (shape.sort?.dir === 'asc' ? a[1] - b[1] : b[1] - a[1]) || compareCells(a[0], b[0], 1))
    .slice(0, keyLimit)
    .map(([k]) => k);
  const rank = new Map(keys.map((k, r) => [k, r]));
  groups = groups
    .filter((g) => rank.has(g.key))
    .sort((a, b) => rank.get(a.key)! - rank.get(b.key)! || a.bucket! - b.bucket!);
  return { total, value: null, groups, rows: null };
}

/** A `ShapeTable` over plain row objects (client-side REST datasets). */
export function objectTable(rows: readonly Record<string, Cell>[]): ShapeTable {
  return { count: rows.length, col: (f) => (i) => rows[i]![f] ?? null };
}
