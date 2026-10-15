import { memo } from 'react';
import { cn } from '@/shared/lib/utils';
import { TONE_COLOR, type Ring } from '../lib/vehicle-details-model';

const R = 15;
const C = 2 * Math.PI * R;

/** Mockup `.ringtile`: circular gauge with the value in the middle. */
export const RingGauge = memo(function RingGauge({
  ring,
  label,
  size = 70,
}: {
  ring: Ring;
  label: string;
  size?: number;
}) {
  const color = TONE_COLOR[ring.tone];
  return (
    <div
      className="flex flex-col items-center rounded-[var(--radius-tile)] border border-tile-border bg-tile px-1 pt-2.5 pb-2 text-center"
      data-testid={`ring-${label.toLowerCase()}`}
      role="img"
      aria-label={`${label}: ${ring.value} ${ring.unit}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 36 36" className="-rotate-90" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            strokeWidth="3"
            style={{ stroke: 'var(--tile-border)' }}
          />
          {ring.fill !== null && (
            <circle
              cx="18"
              cy="18"
              r={R}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${ring.fill * C} ${C}`}
              className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-300"
              style={{ stroke: color }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span
            className={cn(
              'font-display font-black',
              ring.value.length > 4 ? 'text-[13px]' : 'text-[17px]',
            )}
            style={{ color: ring.tone === 'accent' ? undefined : color }}
            data-testid="ring-value"
          >
            {ring.value}
          </span>
          <small className="mt-0.5 text-[9px] font-semibold tracking-[0.1em] text-text-muted">
            {ring.unit}
          </small>
        </div>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold tracking-[0.1em] text-text-muted uppercase">
        {label}
      </div>
    </div>
  );
});
