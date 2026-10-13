import { memo, useId } from 'react';
import { TONE_COLOR, type SessionChart as Chart } from '../lib/vehicle-details-model';

const W = 360;
const H = 80;
const TOP = 6;
const BOTTOM = 66;

/** SOC area chart for the session buffer (F07-R8). */
export const SessionChart = memo(function SessionChart({ chart }: { chart: Chart | null }) {
  const id = useId();
  if (!chart) {
    return (
      <p className="py-6 text-center text-xs text-text-muted" data-testid="session-collecting">
        Collecting…
      </p>
    );
  }
  const color = TONE_COLOR[chart.tone];
  const xy = chart.points.map(([x, y]) => [x * W, TOP + y * (BOTTOM - TOP)] as const);
  const line = xy.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = xy.at(-1)!;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={`State of charge this session, now ${Math.round(chart.latest)}%`}
      data-testid="session-chart"
      data-points={chart.points.length}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <g style={{ stroke: 'var(--tile-border)' }}>
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} />
        ))}
      </g>
      <path d={`${line} L${W} ${BOTTOM} L0 ${BOTTOM}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" strokeWidth="2" style={{ stroke: color }} />
      <circle cx={last[0]} cy={last[1]} r="3.5" style={{ fill: color }} />
      {chart.ticks.map((t) => (
        <text
          key={t.x}
          x={t.x * W}
          y={H - 2}
          textAnchor={t.x === 0 ? 'start' : t.x === 1 ? 'end' : 'middle'}
          fontSize="9"
          fontWeight="700"
          style={{ fill: 'var(--text-faint)' }}
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
});
