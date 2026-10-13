import { memo, type ReactNode } from 'react';

const START = 135;
const SWEEP = 270;
const C = 100;

const rad = (deg: number) => (deg * Math.PI) / 180;
const point = (deg: number, r: number) =>
  [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))] as const;

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export interface RadialGaugeProps {
  label: string;
  value: number | null;
  /** Formatted value for the centre. */
  display: string;
  unit: string;
  min: number;
  max: number;
  ticks: readonly number[];
  color: string;
  children?: ReactNode;
}

/** 270° SVG gauge with labelled ticks; the value arc is clamped to the range. */
export const RadialGauge = memo(function RadialGauge({
  label,
  value,
  display,
  unit,
  min,
  max,
  ticks,
  color,
  children,
}: RadialGaugeProps) {
  const angle = (v: number) =>
    START + (SWEEP * (Math.min(max, Math.max(min, v)) - min)) / (max - min);
  const end = value === null ? START : angle(value);
  const [nx, ny] = point(end, 72);
  return (
    <figure className="flex flex-col items-center" aria-label={`${label} gauge`} role="img">
      <svg viewBox="0 0 200 200" className="w-full max-w-56" aria-hidden>
        <path
          d={arc(START, START + SWEEP, 72)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="3"
        />
        {end > START && (
          <path
            d={arc(START, end, 72)}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
          />
        )}
        {ticks.map((t) => {
          const a = angle(t);
          const [x1, y1] = point(a, 80);
          const [x2, y2] = point(a, 88);
          const [tx, ty] = point(a, 97);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-muted)" strokeWidth="1.5" />
              <text
                x={tx}
                y={ty}
                fill="var(--text-muted)"
                fontSize="9"
                textAnchor={Math.abs(tx - C) < 4 ? 'middle' : tx < C ? 'end' : 'start'}
                dominantBaseline="middle"
              >
                {t}
              </text>
            </g>
          );
        })}
        <circle cx={nx} cy={ny} r="4" fill={color} />
        <circle cx={C} cy={C} r="44" fill="var(--surface-2)" opacity="0.6" />
        <text
          x={C}
          y={C - 4}
          fill="var(--text)"
          fontSize="28"
          fontFamily="var(--font-display)"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {display}
        </text>
        <text x={C} y={C + 20} fill="var(--text-muted)" fontSize="9" textAnchor="middle">
          {unit}
        </text>
        <text
          x={C}
          y={C + 31}
          fill={color}
          fontSize="7"
          letterSpacing="2"
          textAnchor="middle"
          fontWeight="600"
        >
          {label.toUpperCase()}
        </text>
      </svg>
      {children}
      <figcaption className="sr-only">
        {label}: {display} {unit}
      </figcaption>
    </figure>
  );
});
