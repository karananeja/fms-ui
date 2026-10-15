import type { AnalyticsSeries } from '@shared/contract/index.ts';
import type { Widget } from '@shared/contract/dashboards.ts';
import { DayChart } from '@/features/analytics/components/day-chart';
import { KPI_FIELD_META, SERIES_COLORS } from '../lib/metrics';
import { DataBody } from './data-body';
import { useRestWidget } from './widget-data';

type DailyChart = Extract<Widget, { type: 'daily-chart' }>;

const KIND = { bar: 'bars', line: 'lines', area: 'stacked' } as const;

export function DailyChartWidget({ w }: { w: DailyChart }) {
  const state = useRestWidget<AnalyticsSeries>(w);
  const metas = w.metrics.map((m) => KPI_FIELD_META[m]);
  const units = [...new Set(metas.map((m) => m.unit))];
  return (
    <DataBody type="daily-chart" state={state} isEmpty={(s) => s.points.length === 0}>
      {(s) => (
        <div className="widget-chart h-full">
          <DayChart
            title={metas.map((m) => m.label).join(' · ')}
            kind={KIND[w.chart]}
            unit={units.length === 1 ? units[0]! : ''}
            days={s.points.map((p) => p.day)}
            series={w.metrics.map((m, k) => ({
              label: KPI_FIELD_META[m].label,
              color: SERIES_COLORS[k] ?? 'var(--accent)',
              values: s.points.map((p) => KPI_FIELD_META[m].value(p.kpis)),
            }))}
          />
        </div>
      )}
    </DataBody>
  );
}
