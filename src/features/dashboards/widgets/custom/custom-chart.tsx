import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { linear, niceTicks } from '@/features/analytics/lib/chart-scale';

export interface ChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * F26: bars / line / area over string categories (groups, buckets or rows), on the F16 chart
 * scale helpers (nice ticks, thin grid, en-IN numbers), with a hover / ← → tooltip and a
 * visually hidden table for screen readers.
 */
export function CustomChart({
  kind,
  labels,
  series,
  format,
}: {
  kind: 'bar' | 'line' | 'area';
  labels: string[];
  series: ChartSeries[];
  format: (v: number | null) => string;
}) {
  const id = useId();
  const [at, setAt] = useState<number | null>(null);
  const W = 560;
  const H = 220;
  const L = 48;
  const R = 8;
  const T = 10;
  const B = 34;
  const n = labels.length;
  const stacked = kind === 'area' && series.length > 1;
  const tops = labels.map((_, k) =>
    stacked
      ? series.reduce((s, x) => s + (x.values[k] ?? 0), 0)
      : Math.max(0, ...series.map((x) => x.values[k] ?? 0)),
  );
  const ticks = niceTicks(0, Math.max(...tops, 0), 4);
  const y = linear(0, ticks.at(-1)!, H - B, T);
  const band = (W - L - R) / Math.max(1, n);
  const cx = (k: number) => L + band * (k + 0.5);
  const every = Math.max(1, Math.ceil(n / 8));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setAt((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setAt((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setAt(null);
    else return;
    e.preventDefault();
  };
  const path = (vals: number[]) =>
    vals.map((v, k) => `${k ? 'L' : 'M'}${cx(k).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  let shapes: ReactNode;
  if (kind === 'bar') {
    const w = Math.max(1, (band * 0.72) / series.length);
    shapes = series.map((s, si) =>
      s.values.map((v, k) =>
        v ? (
          <rect
            key={`${si}-${k}`}
            data-testid="chart-bar"
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
  } else {
    const base = labels.map(() => 0);
    shapes = series.map((s, si) => {
      const lo = stacked ? base.slice() : labels.map(() => 0);
      const hi = s.values.map((v, k) => (stacked ? lo[k]! : 0) + (v ?? 0));
      if (stacked) hi.forEach((v, k) => (base[k] = v));
      const area = `${path(hi)} ${lo
        .map((_, k) => k)
        .reverse()
        .map((k) => `L${cx(k).toFixed(1)} ${y(lo[k]!).toFixed(1)}`)
        .join(' ')}Z`;
      return (
        <g key={si} data-testid="chart-series">
          {(kind === 'area' || si === 0) && (
            <path d={area} style={{ fill: s.color, fillOpacity: kind === 'area' ? 0.28 : 0.1 }} />
          )}
          <path d={path(hi)} fill="none" strokeWidth="2" style={{ stroke: s.color }} />
        </g>
      );
    });
  }

  return (
    <figure
      className="m-0 flex h-full min-h-0 flex-col"
      data-testid="custom-chart"
      data-kind={kind}
    >
      {series.length > 1 && (
        <figcaption className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="widget-no-drag h-full w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={`Chart with ${n} points. Use the left and right arrow keys to read values.`}
          aria-describedby={`${id}-table`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
          onMouseLeave={() => setAt(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const scale = Math.min(box.width / W, box.height / H);
            const x = (e.clientX - box.left - (box.width - W * scale) / 2) / scale;
            setAt(Math.max(0, Math.min(n - 1, Math.floor((x - L) / band))));
          }}
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
              {format(t)}
            </text>
          ))}
          {shapes}
          {labels.map((l, k) =>
            k % every === 0 ? (
              <text
                key={k}
                x={cx(k)}
                y={H - B + 14}
                textAnchor="middle"
                fontSize="10"
                style={{ fill: 'var(--text-muted)' }}
              >
                {l.length > 12 ? `${l.slice(0, 11)}…` : l}
              </text>
            ) : null,
          )}
        </svg>
        {at !== null && (
          <div
            role="status"
            data-testid="chart-tooltip"
            className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-md border border-glass-border bg-surface-solid px-2.5 py-1.5 text-[11px] shadow-[0_8px_24px_var(--shadow)]"
            style={{
              left: `${(cx(at) / W) * 100}%`,
              transform: `translateX(${cx(at) > W / 2 ? '-105%' : '5%'})`,
            }}
          >
            <p className="mb-0.5 font-semibold">{labels[at]}</p>
            {series.map((s) => (
              <p key={s.label} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-text-muted">{s.label}</span>
                <span className="font-semibold tabular-nums">{format(s.values[at] ?? null)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {/* sr-only on a wrapper: a table never shrinks to 1 px and would widen the widget. */}
      <div className="sr-only">
        <table id={`${id}-table`} data-testid="chart-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, k) => (
              <tr key={k}>
                <th scope="row">{l}</th>
                {series.map((s) => (
                  <td key={s.label}>{format(s.values[k] ?? null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
