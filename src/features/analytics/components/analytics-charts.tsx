import { driverScore, type AnalyticsSeries } from '@shared/contract/index.ts';
import { hours } from '../lib/chart-scale';
import type { Tab } from '../lib/analytics-model';
import { DayChart } from './day-chart';

const per100 = (n: number, km: number) => (km > 0 ? (n / km) * 100 : null);

/** The tab's daily charts (F16-R2 / R3), two per row on desktop. */
export function AnalyticsCharts({ tab, series }: { tab: Tab; series: AnalyticsSeries }) {
  const days = series.points.map((p) => p.day);
  const k = series.points.map((p) => p.kpis);
  const card = 'rounded-[var(--radius-panel)] p-4 shadow-[0_30px_80px_rgb(0_0_0/0.35)] glass';
  if (tab === 'vehicles')
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <DayChart
            title="Daily distance"
            kind="bars"
            unit="km"
            days={days}
            series={[
              { label: 'Distance', color: 'var(--accent)', values: k.map((x) => x.distanceKm) },
            ]}
          />
        </div>
        <div className={card}>
          <DayChart
            title="Uptime vs downtime"
            kind="stacked"
            unit="hours"
            days={days}
            series={[
              {
                label: 'Uptime',
                color: 'var(--st-running)',
                values: k.map((x) => hours(x.uptimeMs)),
              },
              {
                label: 'Downtime',
                color: 'var(--st-stopped)',
                values: k.map((x) => hours(x.downtimeMs)),
              },
            ]}
          />
        </div>
        <div className={card}>
          <DayChart
            title="No-GPS hours"
            kind="lines"
            unit="hours"
            days={days}
            series={[
              { label: 'No-GPS', color: 'var(--st-nogps)', values: k.map((x) => hours(x.noGpsMs)) },
            ]}
          />
        </div>
      </div>
    );
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className={card}>
        <DayChart
          title="Score trend"
          kind="lines"
          unit="/ 100"
          yMax={100}
          days={days}
          series={[
            { label: 'Score', color: 'var(--accent)', values: k.map((x) => driverScore(x)) },
          ]}
        />
      </div>
      <div className={card}>
        <DayChart
          title="Events per 100 km"
          kind="bars"
          unit="/ 100 km"
          days={days}
          series={[
            {
              label: 'Harsh braking',
              color: 'var(--st-stopped)',
              values: k.map((x) => per100(x.harshBrake, x.distanceKm)),
            },
            {
              label: 'Harsh accel.',
              color: 'var(--st-pullout)',
              values: k.map((x) => per100(x.harshAccel, x.distanceKm)),
            },
            {
              label: 'Overspeed',
              color: 'var(--st-nogps)',
              values: k.map((x) => per100(x.overspeed, x.distanceKm)),
            },
          ]}
        />
      </div>
    </div>
  );
}
