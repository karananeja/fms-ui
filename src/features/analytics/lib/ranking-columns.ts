import type { DriverKpis, Kpis, VehicleRanking } from '@shared/contract/index.ts';
import { formatNum, hours } from './chart-scale';

type VehicleRow = VehicleRanking['items'][number];

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const n = (v: number | null) => (v === null ? '—' : formatNum(v));
const events100 = (k: Kpis) =>
  k.distanceKm > 0 ? ((k.harshBrake + k.harshAccel + k.overspeed) / k.distanceKm) * 100 : null;

export interface Col<T> {
  id: string;
  header: string;
  cell: (r: T) => string;
  num?: boolean;
  /** Hidden on narrow screens. */
  wide?: boolean;
}

export const VEHICLE_COLS: Col<VehicleRow>[] = [
  { id: 'regno', header: 'Vehicle', cell: (r) => r.regno },
  { id: 'distance', header: 'Distance km', cell: (r) => n(r.kpis.distanceKm), num: true },
  {
    id: 'uptime',
    header: 'Uptime %',
    cell: (r) => n(pct(r.kpis.uptimeMs, r.kpis.uptimeMs + r.kpis.downtimeMs)),
    num: true,
  },
  {
    id: 'idle',
    header: 'Idle %',
    cell: (r) => n(pct(r.kpis.idleMs, r.kpis.uptimeMs)),
    num: true,
    wide: true,
  },
  { id: 'nogps', header: 'No-GPS h', cell: (r) => n(hours(r.kpis.noGpsMs)), num: true, wide: true },
  {
    id: 'breakdowns',
    header: 'Breakdowns',
    cell: (r) => n(r.kpis.breakdowns),
    num: true,
    wide: true,
  },
];

export const DRIVER_COLS: Col<DriverKpis>[] = [
  { id: 'name', header: 'Driver', cell: (r) => r.name },
  { id: 'score', header: 'Score', cell: (r) => n(r.score), num: true },
  { id: 'distance', header: 'Distance km', cell: (r) => n(r.kpis.distanceKm), num: true },
  {
    id: 'events',
    header: 'Events / 100 km',
    cell: (r) => n(events100(r.kpis)),
    num: true,
    wide: true,
  },
  { id: 'overspeed', header: 'Overspeed', cell: (r) => n(r.kpis.overspeed), num: true, wide: true },
  { id: 'days', header: 'Vehicle-days', cell: (r) => n(r.vehicleDays), num: true, wide: true },
];
