import { BatteryCharging, BatteryLow } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { DeviceComms } from '../lib/vehicle-details-model';
import { Card } from './driving-energy-card';
import { CopyButton, SectionLabel } from './details-ui';

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <SectionLabel>{label}</SectionLabel>
      <span className="flex items-center gap-1.5 font-display text-base font-bold tabular-nums">
        {children}
      </span>
    </div>
  );
}

export const DeviceCommsCard = memo(function DeviceCommsCard({ data }: { data: DeviceComms }) {
  return (
    <Card>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <SectionLabel>ID</SectionLabel>
        <span className="truncate font-display font-bold" data-testid="details-device-id">
          {data.deviceId}
        </span>
        <CopyButton value={data.deviceId} label="Copy device ID" />
      </div>
      <div className="grid grid-cols-3 divide-x">
        <Cell label="Aux">
          <BatteryCharging className="size-4 text-text-muted" aria-hidden />
          <span data-testid="details-aux">{data.aux}</span> V
        </Cell>
        <Cell label="Internal">
          <span data-testid="details-internal">{data.internal}</span> V
          <BatteryLow className="size-4 text-text-muted" aria-hidden />
        </Cell>
        <Cell label="Signal">
          <span data-testid="details-signal">{data.signal}</span>
          <span className="font-sans text-xs font-normal text-text-muted">dBm</span>
        </Cell>
      </div>
    </Card>
  );
});
