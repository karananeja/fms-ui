import { memo } from 'react';
import { detailsConfig } from '../config/details-config';

const CX = 75;
const CY = 78;
const R = 62;

/** Half-circle speedometer 0–max km/h: ticks every 5, labels every 20, red zone above 90. */
export const Speedometer = memo(function Speedometer({
  speed,
  text,
}: {
  speed: number | null;
  text: string;
}) {
  const { max, tick, label, redFrom } = detailsConfig.speedo;
  const n = max / tick;
  const angle = (v: number) => Math.PI * (1 + Math.min(max, Math.max(0, v)) / max);
  const at = (a: number, r: number) => [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
  const end = at(angle(speed ?? 0), R);
  const large = 0; // a half circle never exceeds 180°
  return (
    <svg
      viewBox="0 0 150 100"
      width="150"
      height="100"
      role="img"
      aria-label={`Speed ${text} km/h`}
    >
      {Array.from({ length: n + 1 }, (_, i) => {
        const v = i * tick;
        const big = v % label === 0;
        const a = angle(v);
        const [x1, y1] = at(a, R);
        const [x2, y2] = at(a, R - (big ? 9 : 5));
        const [tx, ty] = at(a, R - 20);
        return (
          <g key={v}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={big ? 2 : 1}
              style={{ stroke: v > redFrom ? 'var(--danger)' : 'var(--text-faint)' }}
            />
            {big && (
              <text
                x={tx}
                y={ty + 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight="600"
                style={{ fill: 'var(--text-faint)' }}
              >
                {v}
              </text>
            )}
          </g>
        );
      })}
      {speed !== null && speed > 0 && (
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 ${large} 1 ${end[0]} ${end[1]}`}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ stroke: 'var(--accent)' }}
        />
      )}
      <text
        x={CX}
        y={CY - 8}
        textAnchor="middle"
        fontSize="30"
        fontWeight="600"
        style={{ fill: 'var(--text)' }}
        data-testid="speedo-value"
      >
        {text}
      </text>
      <text
        x={CX}
        y={CY + 6}
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        style={{ fill: 'var(--text-muted)' }}
      >
        KM/H
      </text>
    </svg>
  );
});
