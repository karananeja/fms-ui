import type { AnalyticsSeries, Kpis } from '@shared/contract/index.ts';
import { cn } from '@/shared/lib/utils';
import { delta, formatValue, type TileDef } from '../lib/analytics-model';
import { Sparkline } from './day-chart';

/** F16-R2/R3: big number + unit, change vs the previous period, and a daily sparkline. */
export function KpiTiles({
  defs,
  kpis,
  previous,
  series,
}: {
  defs: TileDef[];
  kpis: Kpis;
  previous: Kpis | null;
  series: AnalyticsSeries | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-tiles">
      {defs.map((d) => {
        const v = d.value(kpis);
        const change = delta(v, previous ? d.value(previous) : null);
        const good = change !== null && change >= 0 === d.higherIsBetter;
        return (
          <section
            key={d.id}
            data-testid={`tile-${d.id}`}
            data-value={v ?? ''}
            className="flex flex-col gap-1 rounded-[var(--radius-panel)] p-4 shadow-panel glass"
          >
            <h3 className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
              {d.label}
            </h3>
            <p className="flex items-baseline gap-1.5">
              <span
                className="font-display text-2xl font-black tabular-nums"
                data-testid="tile-value"
              >
                {formatValue(v)}
              </span>
              <span className="truncate text-xs text-text-muted">{d.unit}</span>
            </p>
            <div className="flex items-center gap-2">
              {change === null ? (
                <span className="text-[11px] text-text-faint">no comparison</span>
              ) : (
                <span
                  data-testid="tile-delta"
                  title="Change vs the previous period"
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                    Math.abs(change) < 0.05
                      ? 'bg-tile text-text-muted'
                      : good
                        ? 'bg-ok/15 text-ok'
                        : 'bg-danger/15 text-danger',
                  )}
                >
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
                </span>
              )}
              <span className="min-w-0 flex-1">
                <Sparkline
                  values={series?.points.map((p) => d.value(p.kpis)) ?? []}
                  color="var(--accent)"
                />
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
