import { cn } from '@/shared/lib/utils';
import type { LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import type { ConnectionState } from '../worker/worker-api';

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-warn animate-pulse' },
  live: { label: 'Live', dot: 'bg-accent fms-pulse' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warn animate-pulse' },
  offline: { label: 'Offline', dot: 'bg-text-faint' },
  unauthenticated: { label: 'Signed out', dot: 'bg-text-faint' },
  error: { label: 'Error', dot: 'bg-danger' },
};

const selectConnection = (s: LiveTrackingState) => s.connection;
const selectRate = (s: LiveTrackingState) => s.stats.rowsPerSec;
const compactRate = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** DS1-R11: connection state and feed rate, top right of the map; `compact` drops the rate. */
export function LivePill({ compact = false }: { compact?: boolean }) {
  const connection = useLiveTracking(selectConnection);
  const rate = useLiveTracking(selectRate);
  const { label, dot } = CONNECTION[connection];
  return (
    <div
      className={cn(
        'pointer-events-auto ml-auto flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-extrabold tracking-[0.12em] uppercase glass',
        connection === 'live' ? 'text-accent' : 'text-text-muted',
      )}
    >
      <span className={cn('size-2 rounded-full', dot)} aria-hidden />
      <span data-testid="live-connection">{label}</span>
      {connection === 'live' && !compact && (
        <span className="text-text-muted" data-testid="live-rate">
          · {compactRate.format(rate)} rows/s
        </span>
      )}
    </div>
  );
}
