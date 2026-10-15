import type { AnalyticsSeries, Kpis } from '@shared/contract/index.ts';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { delta, formatValue, type TileDef } from '../lib/analytics-model';
import { Sparkline } from './day-chart';

/** One KPI tile: label, Doto value + unit, and an optional footer (delta + sparkline). */
export function KpiTile({
  id,
  label,
  value,
  unit,
  footer,
  bare,
}: {
  id?: string;
  label: string;
  value: number | null;
  unit: string;
  footer?: ReactNode;
  /** No card surface (inside a dashboard widget frame). */
  bare?: boolean;
}) {
  return (
    <section
      data-testid={id ? `tile-${id}` : 'kpi-tile'}
      data-value={value ?? ''}
      className={cn(
        'flex flex-col gap-1',
        !bare && 'rounded-[var(--radius-panel)] p-4 shadow-panel glass',
      )}
    >
      <h3 className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
        {label}
      </h3>
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl font-black tabular-nums" data-testid="tile-value">
          {formatValue(value)}
        </span>
        <span className="truncate text-xs text-text-muted">{unit}</span>
      </p>
      {footer}
    </section>
  );
}

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
          <KpiTile
            key={d.id}
            id={d.id}
            label={d.label}
            value={v}
            unit={d.unit}
            footer={
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
            }
          />
        );
      })}
    </div>
  );
}
