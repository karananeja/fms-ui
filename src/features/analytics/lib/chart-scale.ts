import { IST_OFFSET_MS } from '@shared/contract/index.ts';

const DAY = 86_400_000;

/** "Nice" axis ticks covering [min, max]: steps of 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) max = min === 0 ? 1 : min * 1.1;
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Linear map from a domain to a range. */
export const linear =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number): number =>
    d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/** IST midnight on or before `t` (ms). */
export const istDayStart = (t: number) =>
  Math.floor((t + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;

/** IST date (`YYYY-MM-DD`) of `t`. */
export const istDate = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-14` → "14 Oct". */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Indices of the day labels to show so at most `max` fit (always the first and last). */
export function dayTickIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, k) => k);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let k = 0; k < n - 1; k += step) out.push(k);
  if (n - 1 - out.at(-1)! < step / 2) out.pop();
  out.push(n - 1);
  return out;
}

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

/** en-IN number: 1,23,456 (≥ 100) or one decimal below. */
export const formatNum = (v: number) => (Math.abs(v) >= 100 ? int : one).format(v);

/** Compact axis label: 1.2L, 45K, 950. */
export function formatCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${one.format(v / 1e7)}Cr`;
  if (a >= 1e5) return `${one.format(v / 1e5)}L`;
  if (a >= 1e3) return `${one.format(v / 1e3)}K`;
  return one.format(v);
}

/** Hours from ms, en-IN. */
export const hours = (ms: number) => ms / 3_600_000;
