import type { KpiField, Kpis } from '@shared/contract/analytics.ts';
import type { KpiMetric } from '@shared/contract/dashboards.ts';
import type { AnalyticsSummary } from '@shared/contract/index.ts';
import { hours } from '@/features/analytics/lib/chart-scale';

export interface MetricMeta {
  label: string;
  unit: string;
  /** Display value from KPIs (durations in hours). */
  value(k: Kpis): number | null;
}

const ms = (label: string, f: KpiField): MetricMeta => ({
  label,
  unit: 'h',
  value: (k) => hours(k[f]),
});
const n = (label: string, unit: string, f: KpiField): MetricMeta => ({
  label,
  unit,
  value: (k) => k[f],
});

/** Labels/units of the F11 KPI fields (as F16 tiles: durations in hours). */
export const KPI_FIELD_META: Record<KpiField, MetricMeta> = {
  distanceKm: n('Distance', 'km', 'distanceKm'),
  driveMs: ms('Driving', 'driveMs'),
  idleMs: ms('Idle time', 'idleMs'),
  uptimeMs: ms('Uptime', 'uptimeMs'),
  downtimeMs: ms('Downtime', 'downtimeMs'),
  noGpsMs: ms('No-GPS', 'noGpsMs'),
  energyKwh: n('Energy', 'kWh', 'energyKwh'),
  chargeSessions: n('Charge sessions', '', 'chargeSessions'),
  breakdowns: n('Breakdowns', '', 'breakdowns'),
  harshBrake: n('Harsh braking', 'events', 'harshBrake'),
  harshAccel: n('Harsh acceleration', 'events', 'harshAccel'),
  overspeed: n('Overspeed', 'events', 'overspeed'),
};

/** `kpi` widget metrics: KPI fields plus the summary's derived values. */
export function kpiMetric(metric: KpiMetric): {
  label: string;
  unit: string;
  value(s: AnalyticsSummary): number | null;
} {
  switch (metric) {
    case 'uptimePct':
      return { label: 'Uptime', unit: '%', value: (s) => s.uptimePct };
    case 'eventsPer100Km':
      return { label: 'Events', unit: '/ 100 km', value: (s) => s.eventsPer100Km };
    case 'score':
      return { label: 'Driver score', unit: '/ 100', value: (s) => s.score };
    case 'vehicleCount':
      return { label: 'Vehicles', unit: '', value: (s) => s.vehicleCount };
    default: {
      const m = KPI_FIELD_META[metric];
      return { label: m.label, unit: m.unit, value: (s) => m.value(s.kpis) };
    }
  }
}

/** Series colours for up to 3 metrics (DS3 tokens). */
export const SERIES_COLORS = ['var(--accent)', 'var(--st-charging)', 'var(--st-pullout)'];
