import { memo, useId } from 'react';
import type { Illustration } from '../lib/vehicle-details-model';

const BODY: Record<
  Illustration,
  { wheels: [number, number]; r: number; d: string; cabin?: string }
> = {
  'e-scooter': {
    wheels: [52, 190],
    r: 20,
    d: 'M30 80 C40 60 70 58 92 62 L150 62 C160 62 166 56 170 46 L182 20 L192 20 L196 30 L184 62 C200 66 212 76 214 88 L172 88 C170 76 160 70 148 72 L74 76 C66 78 60 84 58 88 Z',
    cabin: 'M92 62 L100 46 L146 46 L150 62 Z',
  },
  'e-3w': {
    wheels: [60, 180],
    r: 17,
    d: 'M24 88 L24 44 C24 30 34 22 48 22 L150 22 C162 22 170 30 176 40 L206 70 C212 76 214 82 214 88 Z',
    cabin: 'M150 30 L168 42 L194 70 L150 70 Z',
  },
  'e-car': {
    wheels: [62, 180],
    r: 18,
    d: 'M18 86 L20 66 C22 58 30 54 40 52 L74 46 L104 26 C110 22 118 20 126 20 L160 20 C170 20 178 24 184 32 L198 50 L214 56 C220 58 224 64 224 72 L224 86 Z',
    cabin:
      'M84 48 L108 30 L126 28 L126 48 Z M134 28 L160 28 C166 28 172 32 176 38 L184 48 L134 48 Z',
  },
  truck: {
    wheels: [56, 186],
    r: 17,
    d: 'M16 86 L16 18 L140 18 L140 86 Z M146 86 L146 36 L186 36 C194 36 200 40 204 46 L222 70 L222 86 Z',
    cabin: 'M154 42 L184 42 C190 42 194 44 197 48 L208 64 L154 64 Z',
  },
};

/** Hand-drawn side view per asset type on a teal floor glow (F07-R6). */
export const VehicleIllustration = memo(function VehicleIllustration({
  kind,
  className,
}: {
  kind: Illustration;
  className?: string;
}) {
  const id = useId();
  const b = BODY[kind];
  return (
    <svg viewBox="0 0 240 120" className={className} data-illustration={kind} aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--surface-solid)' }} />
          <stop offset=".6" style={{ stopColor: 'var(--st-gpsnever)' }} />
          <stop offset="1" style={{ stopColor: 'var(--surface-solid)' }} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".5" cy=".5" r=".5">
          <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <ellipse cx="120" cy="108" rx="100" ry="9" fill={`url(#${id}g)`} />
      <path
        d={b.d}
        fill={`url(#${id}b)`}
        strokeWidth="1.5"
        style={{ stroke: 'var(--text-faint)' }}
      />
      {b.cabin && (
        <path
          d={b.cabin}
          strokeWidth="1.5"
          style={{ fill: 'var(--bg)', stroke: 'var(--text-faint)' }}
        />
      )}
      {kind === 'e-scooter' && (
        <path
          d="M182 20 L200 14"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ stroke: 'var(--text-muted)' }}
        />
      )}
      <rect
        x="104"
        y="74"
        width="40"
        height="5"
        rx="2"
        style={{ fill: 'var(--accent)', opacity: 0.8 }}
      />
      <circle
        cx={kind === 'e-scooter' ? 207 : 214}
        cy={kind === 'e-scooter' ? 44 : 66}
        r="4"
        style={{ fill: 'var(--warn)' }}
      />
      {b.wheels.map((x) => (
        <g key={x}>
          <circle
            cx={x}
            cy={88}
            r={b.r}
            strokeWidth="5"
            style={{ fill: 'var(--bg)', stroke: 'var(--st-gpsnever)' }}
          />
          <circle cx={x} cy={88} r={b.r * 0.35} style={{ fill: 'var(--accent)' }} />
        </g>
      ))}
    </svg>
  );
});
