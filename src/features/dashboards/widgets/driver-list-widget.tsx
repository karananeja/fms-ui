import { useMemo } from 'react';
import type { Driver } from '@shared/contract/index.ts';
import type { Widget } from '@shared/contract/dashboards.ts';
import { useNavigate } from '@tanstack/react-router';
import { DRIVER_STATUS_META } from '@/features/drivers/lib/driver-format';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import type { LiveTrackingState } from '@/features/live-tracking/store/live-tracking-store';
import { useLiveTracking } from '@/features/live-tracking/store/use-live-tracking';
import { DataBody } from './data-body';
import { useRestWidget } from './widget-data';

type DriverList = Extract<Widget, { type: 'driver-list' }>;

const selectFleets = (s: LiveTrackingState) => s.fleets;

/** §6.3: drivers (F12 REST) by status/fleet/search; a row opens the drivers page. */
export function DriverListWidget({ w }: { w: DriverList }) {
  const state = useRestWidget<{ items: Driver[] }>(w);
  const fleets = useLiveTracking(selectFleets);
  const names = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);
  const navigate = useNavigate();
  const open = () => void navigate({ to: '/admin/drivers' });
  return (
    <DataBody
      type="driver-list"
      state={state}
      isEmpty={(d) => d.items.length === 0}
      emptyText="No drivers match"
    >
      {(d) => (
        <div className="widget-no-drag h-full overflow-auto">
          <table className="w-full text-xs" data-testid="driver-list">
            <thead className="sticky top-0 bg-surface-solid">
              <tr className="h-8 border-b border-glass-border text-left text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                <th scope="col" className="px-2">
                  Driver
                </th>
                <th scope="col" className="px-2">
                  Status
                </th>
                <th scope="col" className="px-2">
                  Fleet
                </th>
                <th scope="col" className="px-2">
                  Phone
                </th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((x) => (
                <tr
                  key={x.id}
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                  className="h-8 cursor-pointer border-b border-glass-border/50 outline-none last:border-b-0 hover:bg-tile focus-visible:bg-tile"
                >
                  <td className="px-2 font-semibold whitespace-nowrap">{x.name}</td>
                  <td className="px-2">
                    <TintPill color={DRIVER_STATUS_META[x.status].color}>
                      {DRIVER_STATUS_META[x.status].label}
                    </TintPill>
                  </td>
                  <td className="px-2 whitespace-nowrap text-text-muted">
                    {names.get(x.fleetId) ?? x.fleetId}
                  </td>
                  <td className="px-2 whitespace-nowrap text-text-muted tabular-nums">{x.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataBody>
  );
}
