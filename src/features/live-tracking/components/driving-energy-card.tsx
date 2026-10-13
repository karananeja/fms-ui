import { BatteryMedium } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { TONE_COLOR, type DrivingEnergy } from '../lib/vehicle-details-model';
import { SectionLabel } from './details-ui';

export function Metric({
  label,
  value,
  unit,
  color,
  testId,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>{label}</SectionLabel>
      <span className="flex items-baseline gap-1">
        <span
          className="font-display text-xl font-bold tabular-nums"
          style={color ? { color } : undefined}
          data-testid={testId}
        >
          {value}
        </span>
        <span className="text-sm text-text-muted">{unit}</span>
      </span>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius-card)] border bg-bg/40 ${className}`}>{children}</div>
  );
}

/** Speed, SOC bar, DTE / SOH / ODO (compact view). */
export const DrivingEnergyCard = memo(function DrivingEnergyCard({
  data,
}: {
  data: DrivingEnergy;
}) {
  const socColor = TONE_COLOR[data.socTone];
  return (
    <Card className="p-4">
      <div className="flex gap-6">
        <div className="flex flex-col gap-2">
          <SectionLabel>Speed</SectionLabel>
          <span className="flex items-baseline gap-2">
            <span
              className="font-display text-3xl font-bold tabular-nums"
              data-testid="details-speed"
            >
              {data.speed}
            </span>
            <span className="text-sm text-text-muted">km/h</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <BatteryMedium className="size-4" style={{ color: socColor }} aria-hidden />
            <SectionLabel>Battery</SectionLabel>
            <span
              className="ml-auto font-display text-xl font-bold tabular-nums"
              style={{ color: socColor }}
              data-testid="details-soc"
              data-tone={data.socTone}
            >
              {data.soc === '—' ? '—' : `${data.soc}%`}
            </span>
          </div>
          <div
            role="meter"
            aria-label="Battery"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={data.socPct ?? undefined}
            className="h-2.5 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${data.socPct ?? 0}%`, background: socColor }}
            />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
        <Metric label="DTE" value={data.dte} unit="km" color="var(--ok)" testId="details-dte" />
        <Metric label="SOH" value={data.soh} unit="%" color="var(--ok)" testId="details-soh" />
        <Metric label="ODO" value={data.odo} unit="km" testId="details-odo" />
      </div>
    </Card>
  );
});
