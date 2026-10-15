import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { Widget } from '@shared/contract/dashboards.ts';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';
import { STATE_COPY } from '../components/widget-states';
import { DataBody } from './data-body';
import { useLiveWidgetData } from './widget-data';

type Breakdown = Extract<Widget, { type: 'status-breakdown' }>;

interface Row {
  status: VehicleStatus;
  count: number;
  pct: number;
}

const pctText = (p: number) => `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;

function Bars({ rows, max }: { rows: Row[]; max: number }) {
  return (
    <ul
      aria-hidden
      className="widget-no-drag flex h-full flex-col justify-center gap-2 overflow-auto"
    >
      {rows.map((r) => (
        <li key={r.status} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-text-muted">{STATUS_META[r.status].label}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2.5 w-full">
            <rect width="100" height="8" rx="2" style={{ fill: 'var(--tile)' }} />
            <rect
              width={max ? (r.count / max) * 100 : 0}
              height="8"
              rx="2"
              style={{ fill: STATUS_META[r.status].color }}
            />
          </svg>
          <span className="text-right tabular-nums">
            <span className="font-semibold">{formatNum(r.count)}</span>
            <span className="ml-1 text-text-faint">{pctText(r.pct)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const R = 42;
const C = 2 * Math.PI * R;

function Donut({ rows, total }: { rows: Row[]; total: number }) {
  const lens = rows.map((r) => (total ? (r.count / total) * C : 0));
  const offsets = lens.map((_, k) => lens.slice(0, k).reduce((a, b) => a + b, 0));
  return (
    <div aria-hidden className="flex h-full min-h-0 items-center gap-4">
      <svg
        viewBox="0 0 120 120"
        preserveAspectRatio="xMidYMid meet"
        className="h-full max-h-40 min-h-0 w-auto shrink-0"
      >
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="14"
          style={{ stroke: 'var(--tile)' }}
        />
        {rows.map((r, k) => {
          const len = lens[k]!;
          return (
            <circle
              key={r.status}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offsets[k]!}
              transform="rotate(-90 60 60)"
              style={{ stroke: STATUS_META[r.status].color }}
            />
          );
        })}
        <text
          x="60"
          y="64"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          className="font-display"
          style={{ fill: 'var(--text)' }}
        >
          {formatNum(total)}
        </text>
      </svg>
      <ul className="widget-no-drag min-w-0 flex-1 space-y-1 overflow-auto text-xs">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_META[r.status].color }}
            />
            <span className="flex-1 truncate text-text-muted">{STATUS_META[r.status].label}</span>
            <span className="font-semibold tabular-nums">{formatNum(r.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** §6.3: per-status counts from the worker as bars or a donut (`var(--st-…)` colours). */
export function StatusBreakdownWidget({ w }: { w: Breakdown }) {
  const state = useLiveWidgetData(
    w,
    { kind: 'counts', fleetId: w.fleetId },
    w.fleetId ? [w.fleetId] : [],
  );
  const statuses = w.statuses ?? VEHICLE_STATUSES;
  return (
    <DataBody type="status-breakdown" state={state}>
      {(r) => {
        if (r.kind !== 'counts') return null;
        const rows = VEHICLE_STATUSES.filter((s) => statuses.includes(s)).map((s) => ({
          status: s,
          count: r.counts[s],
          pct: 0,
        }));
        const total = rows.reduce((s, x) => s + x.count, 0);
        rows.forEach((x) => (x.pct = total ? (x.count / total) * 100 : 0));
        if (!total)
          return (
            <p className="grid h-full place-items-center text-xs text-text-muted">
              {STATE_COPY.noVehicles}
            </p>
          );
        return (
          <div className="h-full" data-testid="status-breakdown" data-total={total}>
            <ul className="sr-only">
              {rows.map((x) => (
                <li key={x.status}>
                  {STATUS_META[x.status].label}: {x.count} ({pctText(x.pct)})
                </li>
              ))}
            </ul>
            {w.display === 'donut' ? (
              <Donut rows={rows} total={total} />
            ) : (
              <Bars rows={rows} max={Math.max(...rows.map((x) => x.count))} />
            )}
          </div>
        );
      }}
    </DataBody>
  );
}
