import type { VehicleRanking } from '@shared/contract/index.ts';
import type { TimeRange, Widget } from '@shared/contract/dashboards.ts';
import { useNavigate } from '@tanstack/react-router';
import type { DriverRanking } from '@/features/analytics/api/analytics-api';
import { RankingTable, type Entity } from '@/features/analytics/components/ranking-table';
import { formatValue, istDate } from '@/features/analytics/lib/analytics-model';
import type { Col } from '@/features/analytics/lib/ranking-columns';
import { useCan } from '@/features/access/permissions/can';
import { resolveRange } from '../data/time-range';
import { KPI_FIELD_META } from '../lib/metrics';
import { DataBody } from './data-body';
import { useRestWidget } from './widget-data';

type Ranking = Extract<Widget, { type: 'ranking' }>;
type Row = { kpis: VehicleRanking['items'][number]['kpis']; score?: number | null };

/** Analytics URL search for a widget range (F16 presets, or a custom IST-day range). */
function analyticsRange(range: TimeRange, now: number): Record<string, string> {
  if (range === '7d' || range === '30d' || range === '90d') return { range };
  const { from, to } = resolveRange(range, now);
  return { range: 'custom', from: istDate(from), to: istDate(to - 1) };
}

export function RankingWidget({ w }: { w: Ranking }) {
  const state = useRestWidget<VehicleRanking | DriverRanking>(w);
  const navigate = useNavigate();
  const canOpen = useCan('analytics.view');
  const meta =
    w.metric === 'score'
      ? { label: 'Score', unit: '/ 100', value: (r: Row) => r.score ?? null }
      : {
          ...KPI_FIELD_META[w.metric],
          value: (r: Row) => KPI_FIELD_META[w.metric as keyof typeof KPI_FIELD_META].value(r.kpis),
        };
  const metricCol: Col<unknown> = {
    id: 'metric',
    header: meta.unit ? `${meta.label} ${meta.unit}` : meta.label,
    cell: (r) => formatValue(meta.value(r as Row)),
    num: true,
  };
  const open = (e: Entity) =>
    void navigate({
      to: '/analytics',
      search: {
        tab: e.kind === 'vehicle' ? 'vehicles' : 'drivers',
        [e.kind]: e.id,
        ...analyticsRange(w.range, Date.now()),
      },
    });
  return (
    <DataBody type="ranking" state={state} isEmpty={(r) => r.items.length === 0}>
      {(r) => (
        <div className="widget-no-drag h-full">
          <RankingTable
            tab={w.entity}
            ranking={r}
            compact={{ metricCol }}
            onOpen={canOpen ? open : undefined}
          />
        </div>
      )}
    </DataBody>
  );
}
