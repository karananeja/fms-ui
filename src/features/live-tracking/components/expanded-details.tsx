import { BatteryMedium } from 'lucide-react';
import { memo } from 'react';
import { detailsConfig } from '../config/details-config';
import { TONE_COLOR, type DrivingEnergy } from '../lib/vehicle-details-model';
import { Card, Metric } from './driving-energy-card';
import { SectionLabel } from './details-ui';
import { RadialGauge } from './radial-gauge';

const { speed, rpm } = detailsConfig.gauges;

/** Speed + RPM gauges and the ODO strip (expanded view). */
export const ExpandedDetails = memo(function ExpandedDetails({ data }: { data: DrivingEnergy }) {
  const socColor = TONE_COLOR[data.socTone];
  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-4">
        <RadialGauge
          label="Speed"
          value={data.speedValue}
          display={data.speed}
          unit="km/h"
          color="var(--accent)"
          {...speed}
        >
          <span className="flex items-center gap-1.5" style={{ color: socColor }}>
            <BatteryMedium className="size-4" aria-hidden />
            <span className="font-display text-xl font-bold" data-testid="details-gauge-soc">
              {data.soc === '—' ? '—' : `${data.soc}%`}
            </span>
          </span>
          <SectionLabel>SOC</SectionLabel>
        </RadialGauge>
        <RadialGauge
          label="Motor"
          value={data.rpmValue}
          display={data.rpm}
          unit="rpm"
          color="var(--st-charging)"
          {...rpm}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 border-t pt-4">
        <div className="flex items-center gap-2">
          <SectionLabel>ODO</SectionLabel>
          <span
            className="flex gap-1"
            aria-label={`Odometer ${data.odo} km`}
            data-testid="details-odo-strip"
          >
            {data.odoDigits.map((d, i) => (
              <span
                key={i}
                aria-hidden
                className="flex h-8 w-6 items-center justify-center rounded-md border border-accent/60 bg-surface-2 font-display text-lg font-bold"
              >
                {d}
              </span>
            ))}
          </span>
          <span className="text-sm text-text-muted">km</span>
        </div>
        <Metric label="DTE" value={data.dte} unit="km" color="var(--ok)" testId="details-x-dte" />
        <Metric label="SOH" value={data.soh} unit="%" color="var(--ok)" testId="details-x-soh" />
      </div>
    </Card>
  );
});
