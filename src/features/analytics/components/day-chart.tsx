import { useId, useState, type KeyboardEvent } from 'react';
import {
  dayLabel,
  dayTickIndices,
  formatCompact,
  formatNum,
  linear,
  niceTicks,
} from '../lib/chart-scale';

export interface Series {
  label: string;
  /** CSS colour (DS1 token). */
  color: string;
  values: (number | null)[];
}

export interface DayChartProps {
  title: string;
  /** IST dates, one per point. */
  days: string[];
  series: Series[];
  /**
   * `bars`: grouped daily bars; `lines`: line(s) with a light area under the first; `stacked`:
   * stacked areas; `stacked-bars`: one bar per day, series stacked (F30).
   */
  kind: 'bars' | 'lines' | 'stacked' | 'stacked-bars';
  unit: string;
  /** Fixed y maximum (e.g. 100 for %); otherwise from the data. */
  yMax?: number;
}

const W = 560;
const H = 200;
const L = 40;
const R = 8;
const T = 10;
const B = 24;

/**
 * F16-R6 / D-103: in-house SVG chart over IST days. Nice y ticks, thin grid, en-IN numbers,
 * hover or keyboard (← →) shows a tooltip, a visually hidden table for screen readers, and an
 * explicit empty state.
 */
export function DayChart({ title, days, series, kind, unit, yMax }: DayChartProps) {
  const id = useId();
  const [at, setAt] = useState<number | null>(null);
  const n = days.length;
  const stacked = kind === 'stacked';
  const totals = days.map((_, k) =>
    stacked || kind === 'stacked-bars'
      ? series.reduce((s, x) => s + (x.values[k] ?? 0), 0)
      : Math.max(0, ...series.map((x) => x.values[k] ?? 0)),
  );
  const hasData = series.some((s) => s.values.some((v) => v !== null && v > 0));
  const ticks = niceTicks(0, yMax ?? Math.max(...totals, 0), 4);
  const top = ticks.at(-1)!;
  const y = linear(0, top, H - B, T);
  const band = (W - L - R) / Math.max(1, n);
  const cx = (k: number) => L + band * (k + 0.5);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setAt((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setAt((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setAt(null);
    else return;
    e.preventDefault();
  };

  const path = (vals: number[]) =>
    vals.map((v, k) => `${k ? 'L' : 'M'}${cx(k).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  let shapes: React.ReactNode;
  if (kind === 'bars') {
    const w = Math.max(1, (band * 0.7) / series.length);
    shapes = series.map((s, si) =>
      s.values.map((v, k) =>
        v ? (
          <rect
            key={`${si}-${k}`}
            x={cx(k) - (w * series.length) / 2 + si * w}
            y={y(v)}
            width={w}
            height={Math.max(0, H - B - y(v))}
            rx={Math.min(2, w / 3)}
            style={{ fill: s.color, opacity: at === null || at === k ? 1 : 0.55 }}
          />
        ) : null,
      ),
    );
  } else if (kind === 'stacked-bars') {
    const w = Math.max(1, band * 0.7);
    const base = days.map(() => 0);
    shapes = series.map((s, si) =>
      s.values.map((v, k) => {
        if (!v) return null;
        const lo = base[k]!;
        base[k] = lo + v;
        return (
          <rect
            key={`${si}-${k}`}
            x={cx(k) - w / 2}
            y={y(lo + v)}
            width={w}
            height={Math.max(0, y(lo) - y(lo + v))}
            style={{ fill: s.color, opacity: at === null || at === k ? 1 : 0.55 }}
          />
        );
      }),
    );
  } else if (stacked) {
    const base = days.map(() => 0);
    shapes = series.map((s, si) => {
      const lo = base.slice();
      const hi = base.map((b, k) => b + (s.values[k] ?? 0));
      hi.forEach((v, k) => (base[k] = v));
      const d = `${path(hi)} ${lo
        .map((_, k) => k)
        .reverse()
        .map((k) => `L${cx(k).toFixed(1)} ${y(lo[k]!).toFixed(1)}`)
        .join(' ')}Z`;
      return (
        <g key={si}>
          <path d={d} style={{ fill: s.color, fillOpacity: 0.28 }} />
          <path d={path(hi)} fill="none" strokeWidth="1.5" style={{ stroke: s.color }} />
        </g>
      );
    });
  } else {
    shapes = series.map((s, si) => {
      const vals = s.values.map((v) => v ?? 0);
      return (
        <g key={si}>
          {si === 0 && (
            <path
              d={`${path(vals)} L${cx(n - 1)} ${H - B} L${cx(0)} ${H - B}Z`}
              style={{ fill: s.color, fillOpacity: 0.12 }}
            />
          )}
          <path
            d={path(vals)}
            fill="none"
            strokeWidth={si === 0 ? 2 : 1.5}
            strokeDasharray={si === 0 ? undefined : '4 3'}
            style={{ stroke: s.color }}
          />
        </g>
      );
    });
  }

  const tip = at !== null && (
    <div
      role="status"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-glass-border bg-surface-solid px-2.5 py-1.5 text-[11px] shadow-[0_8px_24px_var(--shadow)]"
      style={{
        left: `${(cx(at) / W) * 100}%`,
        transform: `translateX(${cx(at) > W / 2 ? '-105%' : '5%'})`,
      }}
    >
      <p className="mb-0.5 font-semibold">{dayLabel(days[at]!)}</p>
      {series.map((s) => (
        <p key={s.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          <span className="flex-1 text-text-muted">{s.label}</span>
          <span className="font-semibold tabular-nums">
            {s.values[at] === null ? '—' : formatNum(s.values[at]!)}
          </span>
        </p>
      ))}
    </div>
  );

  return (
    <figure className="m-0" data-testid="day-chart" data-kind={kind}>
      {/* Wraps in narrow cards: the legend never pushes the card wider. */}
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
        <span className="min-w-0 flex-1">{title}</span>
        {series.length > 1 &&
          series.map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1 tracking-normal whitespace-nowrap normal-case"
            >
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        <span className="tracking-normal whitespace-nowrap normal-case">{unit}</span>
      </figcaption>
      {!hasData ? (
        <p
          className="grid h-[200px] place-items-center rounded-tile border border-dashed border-tile-border text-xs text-text-muted"
          data-testid="chart-empty"
        >
          No data for this period
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={`${title}, ${n} days. Use the left and right arrow keys to read values.`}
            aria-describedby={`${id}-table`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setAt(null)}
            onMouseLeave={() => setAt(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - box.left) / box.width) * W;
              setAt(Math.max(0, Math.min(n - 1, Math.floor((x - L) / band))));
            }}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <g style={{ stroke: 'var(--tile-border)' }}>
              {ticks.map((t) => (
                <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
              ))}
            </g>
            {ticks.map((t) => (
              <text
                key={t}
                x={L - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize="10"
                style={{ fill: 'var(--text-faint)' }}
              >
                {formatCompact(t)}
              </text>
            ))}
            {dayTickIndices(n).map((k) => (
              <text
                key={k}
                x={cx(k)}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                style={{ fill: 'var(--text-faint)' }}
              >
                {dayLabel(days[k]!)}
              </text>
            ))}
            {shapes}
            {at !== null && (
              <line
                x1={cx(at)}
                x2={cx(at)}
                y1={T}
                y2={H - B}
                strokeDasharray="3 3"
                style={{ stroke: 'var(--text-muted)' }}
              />
            )}
          </svg>
          {tip}
        </div>
      )}
      {/* sr-only on a div, not the table: a table never shrinks below its content, so a 1 px
          sr-only table still spans ~600 px and pushes narrow panels sideways. */}
      <div className="sr-only">
        <table id={`${id}-table`}>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label} ({unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, k) => (
              <tr key={d}>
                <th scope="row">{d}</th>
                {series.map((s) => (
                  <td key={s.label}>{s.values[k] === null ? '' : formatNum(s.values[k]!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** A tiny trend line for a KPI tile. */
export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const vals = values.map((v) => v ?? 0);
  if (vals.length < 2 || vals.every((v) => v === 0))
    return <svg width="100%" height="24" aria-hidden />;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const d = vals
    .map((v, k) => {
      const x = (k / (vals.length - 1)) * 100;
      const yy = 22 - (max === min ? 10 : ((v - min) / (max - min)) * 20);
      return `${k ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 24" width="100%" height="24" preserveAspectRatio="none" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: color }}
      />
    </svg>
  );
}
