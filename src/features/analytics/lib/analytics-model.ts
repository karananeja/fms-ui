import { driverScore, type Kpis } from '@shared/contract/index.ts';
import { formatNum, hours, istDate, istDayStart } from './chart-scale';

const DAY = 86_400_000;

export type Tab = 'vehicles' | 'drivers';
export type RangeId = '7d' | '30d' | '90d' | 'custom';

export interface Filters {
  tab: Tab;
  range: RangeId;
  /** Custom range, IST dates (`YYYY-MM-DD`), inclusive. */
  from?: string;
  to?: string;
  fleetId?: string;
  vehicleId?: string;
  driverId?: string;
}

export const MAX_DAYS = 90;

/** `[from, to)` in ms for the filters at `now`: preset ranges end now; custom covers whole IST days. */
export function windowOf(f: Filters, now: number): { from: number; to: number } {
  if (f.range === 'custom' && f.from && f.to) {
    const from = Date.parse(`${f.from}T00:00:00+05:30`);
    const to = Math.min(now, Date.parse(`${f.to}T00:00:00+05:30`) + DAY);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from)
      return { from: Math.max(from, to - MAX_DAYS * DAY), to };
  }
  const days = f.range === '7d' ? 7 : f.range === '90d' ? MAX_DAYS : 30;
  // Rounded to the minute so repeated renders hit the same cache entry.
  const to = Math.floor(now / 60_000) * 60_000;
  return { from: to - days * DAY, to };
}

/** The window just before `w`, of the same length (for deltas). */
export const previousWindow = (w: { from: number; to: number }) => ({
  from: w.from - (w.to - w.from),
  to: w.from,
});

/** URL search → filters (unknown values dropped). */
export function parseFilters(s: Record<string, unknown>): Filters {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const date = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  const range = (['7d', '30d', '90d', 'custom'] as const).find((r) => r === String(s.range)) ?? '30d';
  return {
    tab: s.tab === 'drivers' ? 'drivers' : 'vehicles',
    range,
    ...(range === 'custom' && { from: date(s.from), to: date(s.to) }),
    ...(str(s.fleet) && { fleetId: str(s.fleet) }),
    ...(str(s.vehicle) && { vehicleId: str(s.vehicle) }),
    ...(str(s.driver) && { driverId: str(s.driver) }),
  };
}

/** Filters → URL search (defaults omitted, so the default view has a clean URL). */
export function toSearch(f: Filters): Record<string, string> {
  return {
    ...(f.tab !== 'vehicles' && { tab: f.tab }),
    ...(f.range !== '30d' && { range: f.range }),
    ...(f.range === 'custom' && f.from && { from: f.from }),
    ...(f.range === 'custom' && f.to && { to: f.to }),
    ...(f.fleetId && { fleet: f.fleetId }),
    ...(f.vehicleId && { vehicle: f.vehicleId }),
    ...(f.driverId && { driver: f.driverId }),
  };
}

export interface TileDef {
  id: string;
  label: string;
  unit: string;
  /** Value over a whole window (from summed KPIs); `null` = not applicable. */
  value: (k: Kpis) => number | null;
  /** Higher is better (green delta when it rises). */
  higherIsBetter: boolean;
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const per100 = (n: number, km: number) => (km > 0 ? (n / km) * 100 : null);

export const VEHICLE_TILES: TileDef[] = [
  {
    id: 'distance',
    label: 'Distance',
    unit: 'km',
    value: (k) => k.distanceKm,
    higherIsBetter: true,
  },
  {
    id: 'uptime',
    label: 'Uptime',
    unit: '%',
    value: (k) => pct(k.uptimeMs, k.uptimeMs + k.downtimeMs),
    higherIsBetter: true,
  },
  {
    id: 'idle',
    label: 'Idle',
    unit: '% of uptime',
    value: (k) => pct(k.idleMs, k.uptimeMs),
    higherIsBetter: false,
  },
  {
    id: 'breakdowns',
    label: 'Breakdowns',
    unit: '',
    value: (k) => k.breakdowns,
    higherIsBetter: false,
  },
  {
    id: 'noGps',
    label: 'No-GPS',
    unit: 'h',
    value: (k) => hours(k.noGpsMs),
    higherIsBetter: false,
  },
  {
    id: 'energy',
    label: 'Energy',
    unit: 'kWh / km',
    value: (k) => (k.distanceKm > 0 ? k.energyKwh / k.distanceKm : null),
    higherIsBetter: false,
  },
  {
    id: 'charges',
    label: 'Charge sessions',
    unit: '',
    value: (k) => k.chargeSessions,
    higherIsBetter: true,
  },
];

export const DRIVER_TILES: TileDef[] = [
  {
    id: 'distance',
    label: 'Distance',
    unit: 'km',
    value: (k) => k.distanceKm,
    higherIsBetter: true,
  },
  {
    id: 'driving',
    label: 'Driving',
    unit: 'h',
    value: (k) => hours(k.driveMs),
    higherIsBetter: true,
  },
  {
    id: 'idle',
    label: 'Idle',
    unit: '% of uptime',
    value: (k) => pct(k.idleMs, k.uptimeMs),
    higherIsBetter: false,
  },
  {
    id: 'harshBrake',
    label: 'Harsh braking',
    unit: '/ 100 km',
    value: (k) => per100(k.harshBrake, k.distanceKm),
    higherIsBetter: false,
  },
  {
    id: 'harshAccel',
    label: 'Harsh acceleration',
    unit: '/ 100 km',
    value: (k) => per100(k.harshAccel, k.distanceKm),
    higherIsBetter: false,
  },
  {
    id: 'overspeed',
    label: 'Overspeed',
    unit: 'events',
    value: (k) => k.overspeed,
    higherIsBetter: false,
  },
  {
    id: 'breakdowns',
    label: 'Breakdowns reported',
    unit: '',
    value: (k) => k.breakdowns,
    higherIsBetter: false,
  },
  {
    id: 'score',
    label: 'Avg score',
    unit: '/ 100',
    value: (k) => driverScore(k),
    higherIsBetter: true,
  },
];

/** Change vs the previous period in %, or `null` when there is nothing to compare with. */
export function delta(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null || prev === 0) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

export const formatValue = (v: number | null) => (v === null ? '—' : formatNum(v));

/** Ranking sort keys per tab (KPI field or `score`), with labels. */
export const VEHICLE_SORTS = [
  { key: 'distanceKm', label: 'Distance' },
  { key: 'uptimeMs', label: 'Uptime' },
  { key: 'idleMs', label: 'Idle time' },
  { key: 'noGpsMs', label: 'No-GPS time' },
  { key: 'breakdowns', label: 'Breakdowns' },
  { key: 'energyKwh', label: 'Energy' },
] as const;
export const DRIVER_SORTS = [
  { key: 'score', label: 'Score' },
  { key: 'distanceKm', label: 'Distance' },
  { key: 'overspeed', label: 'Overspeed' },
  { key: 'harshBrake', label: 'Harsh braking' },
] as const;

export { istDate, istDayStart };

/** RFC 4180 CSV with a header row. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
