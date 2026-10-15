import type { AnalyticsSummary } from '@shared/contract/index.ts';
import type { Widget } from '@shared/contract/dashboards.ts';
import { KpiTile } from '@/features/analytics/components/kpi-tiles';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';
import { RANGE_LABEL } from '../data/time-range';
import { kpiMetric } from '../lib/metrics';
import { DataBody } from './data-body';
import { useLiveWidgetData, useRestWidget } from './widget-data';

type Kpi = Extract<Widget, { type: 'kpi' }>;

const Footer = ({ children }: { children: string }) => (
  <p className="truncate text-[11px] text-text-faint">{children}</p>
);

function AnalyticsKpi({ w }: { w: Extract<Kpi, { source: 'analytics' }> }) {
  const state = useRestWidget<AnalyticsSummary>(w);
  const meta = kpiMetric(w.metric);
  return (
    <DataBody type="kpi" state={state}>
      {(s) => (
        <KpiTile
          bare
          label={meta.label}
          value={meta.value(s)}
          unit={meta.unit}
          footer={<Footer>{RANGE_LABEL[w.range]}</Footer>}
        />
      )}
    </DataBody>
  );
}

function LiveKpi({ w }: { w: Extract<Kpi, { source: 'live' }> }) {
  const state = useLiveWidgetData(
    w,
    { kind: 'counts', fleetId: w.fleetId },
    w.fleetId ? [w.fleetId] : [],
  );
  const label = w.status === 'total' ? 'Total vehicles' : STATUS_META[w.status].label;
  return (
    <DataBody type="kpi" state={state}>
      {(r) =>
        r.kind === 'counts' && (
          <div className="flex items-start gap-2">
            {w.status !== 'total' && (
              <span
                aria-hidden
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ background: STATUS_META[w.status].color }}
              />
            )}
            <KpiTile
              bare
              label={label}
              value={w.status === 'total' ? r.total : r.counts[w.status]}
              unit="vehicles"
              footer={<Footer>Live</Footer>}
            />
          </div>
        )
      }
    </DataBody>
  );
}

export function KpiWidget({ w }: { w: Kpi }) {
  return w.source === 'live' ? <LiveKpi w={w} /> : <AnalyticsKpi w={w} />;
}
