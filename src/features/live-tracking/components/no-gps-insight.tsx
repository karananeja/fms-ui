import type { LikelyCause, NoGpsInsight as Insight } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import {
  BatteryWarning,
  CircleHelp,
  KeyRound,
  MessageSquareWarning,
  SignalLow,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { formatIstShort, formatRelativeTime } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { eventsSocket } from '@/features/notifications/events-socket';
import { noGpsInsight } from '@/features/requests/api/requests-api';
import { REASON_LABEL } from '@/features/requests/lib/request-model';
import { requestDeskStore } from '@/features/requests/request-desk-store';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { SectionLabel, Skeleton, Tile } from './details-ui';

export interface NoGpsInsightProps {
  vehicleId: string;
  /** Live values for the chips (the card's `combinfo`), when known. */
  devbattery?: number | null;
  rxdbm?: number | null;
}

const CAUSE_ICON: Record<LikelyCause, LucideIcon> = {
  'driver-reported': MessageSquareWarning,
  'device-offline': WifiOff,
  'device-battery-low': BatteryWarning,
  'weak-signal': SignalLow,
  'ignition-off': KeyRound,
  unknown: CircleHelp,
};

/** The open breakdown's id for this vehicle, from the desk store (loaded for `requests.manage`). */
function useOpenBreakdownId(vehicleId: string): string | null {
  return useSyncExternalStore(
    requestDeskStore.subscribe,
    () => requestDeskStore.openBreakdown(vehicleId)?.id ?? null,
  );
}

/**
 * F14-R5 / D-102: "Why no GPS?" in the F07 Overview tab while the vehicle is in no-GPS. The
 * likely cause (icon + the F11 sentence), since when, the device signals as chips, and the
 * driver-reported reason with a link to the request. Fetched when the card opens and again on
 * any `request` event for this vehicle. Needs `vehicle.details.view`.
 */
export function NoGpsInsight(props: NoGpsInsightProps) {
  const allowed = useCan('vehicle.details.view');
  if (!allowed) return null;
  return <InsightSection {...props} />;
}

function InsightSection({ vehicleId, devbattery, rxdbm }: NoGpsInsightProps) {
  const res = useResource<Insight | null>(
    (signal) =>
      noGpsInsight(vehicleId, { signal }).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    vehicleId,
  );
  const { reload } = res;
  useEffect(
    () =>
      eventsSocket.onEvent('request', (r) => {
        if (r.vehicleId === vehicleId) reload();
      }),
    [vehicleId, reload],
  );
  const canDesk = useCan('requests.manage');
  useEffect(() => (canDesk ? requestDeskStore.retain() : undefined), [canDesk]);
  const requestId = useOpenBreakdownId(vehicleId);
  const now = useNow(60_000);

  if (res.data === null) return null;
  if (!res.data) {
    return res.error ? null : <Skeleton className="h-[112px]" label="no-GPS insight" />;
  }
  const i = res.data;
  const Icon = CAUSE_ICON[i.likelyCause];
  const chips: { label: string; on: boolean }[] = [
    {
      label: `Device battery${devbattery != null ? ` ${devbattery.toFixed(1)} V` : i.signals.devBatteryLow ? ' low' : ' OK'}`,
      on: i.signals.devBatteryLow,
    },
    {
      label: `Signal${rxdbm != null ? ` ${Math.round(rxdbm)} dBm`.replace('-', '−') : i.signals.weakSignal ? ' weak' : ' OK'}`,
      on: i.signals.weakSignal,
    },
    { label: i.signals.ignitionOff ? 'Ignition off' : 'Ignition on', on: i.signals.ignitionOff },
    {
      label: i.signals.deviceOffline ? 'Device offline' : 'Device online',
      on: i.signals.deviceOffline,
    },
  ];

  return (
    <Tile data-testid="no-gps-insight">
      <SectionLabel className="mb-2 block">Why no GPS?</SectionLabel>
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
        <p className="text-sm" data-testid="no-gps-cause" data-cause={i.likelyCause}>
          {i.explanation}
        </p>
      </div>
      <p className="mt-2 text-xs text-text-muted" data-testid="no-gps-since">
        No fix since {formatRelativeTime(i.since, now)} · {formatIstShort(i.since)}
      </p>
      <ul aria-label="Device signals" className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <li
            key={c.label}
            data-flagged={c.on || undefined}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[11px] font-bold',
              c.on ? 'border-warn/50 bg-warn/15 text-warn' : 'border-tile-border text-text-muted',
            )}
          >
            {c.label}
          </li>
        ))}
      </ul>
      {i.reportedReason && (
        <p className="mt-2 text-xs" data-testid="no-gps-reported">
          <span className="text-text-muted">Driver reported: </span>
          <span className="font-bold">{REASON_LABEL[i.reportedReason]}</span>
          {canDesk && requestId && (
            <>
              {' · '}
              <Link
                to="/requests/$requestId"
                params={{ requestId }}
                className="font-bold text-accent hover:underline"
              >
                View request
              </Link>
            </>
          )}
        </p>
      )}
    </Tile>
  );
}
