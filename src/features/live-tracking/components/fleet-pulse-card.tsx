import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { STATUS_META } from '../config/status-meta';
import { formatCount } from '../lib/format-count';
import { scopeLabel, SPARK, sparkPaths } from '../lib/status-bar-model';
import { pulseChange } from '../store/fleet-pulse';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';

const COLLAPSED_KEY = 'fms.pulse.collapsed';
const W = SPARK.w;
const H = SPARK.h;

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    // Storage unavailable: the card just doesn't remember.
  }
};

const selectFilter = (s: LiveTrackingState) => s.filter;
const selectCounts = (s: LiveTrackingState) => s.filteredCounts;
const selectTotal = (s: LiveTrackingState) => s.filteredTotal;
const selectPulse = (s: LiveTrackingState) => s.pulse;
const selectFleets = (s: LiveTrackingState) => s.fleets;

/**
 * F08-R10 (desktop): filtered total, status stack and legend, and the running count over the
 * last hour from real samples only ("Collecting…" until there are two).
 */
export function FleetPulseCard({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const filter = useLiveTracking(selectFilter, Object.is, store);
  const counts = useLiveTracking(selectCounts, Object.is, store);
  const total = useLiveTracking(selectTotal, Object.is, store);
  const pulse = useLiveTracking(selectPulse, Object.is, store);
  const fleets = useLiveTracking(selectFleets, Object.is, store);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const names = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);
  // With a status filter, only the chosen statuses are in `total`; the stack and legend agree.
  const shown = (s: VehicleStatus) =>
    !filter.statuses?.length || filter.statuses.includes(s) ? counts[s] : 0;
  const change = pulseChange(pulse);
  const spark = pulse.length >= 2 ? sparkPaths(pulse) : null;

  const toggle = () => {
    setCollapsed(!collapsed);
    writeCollapsed(!collapsed);
  };

  return (
    <section
      aria-label="Fleet pulse"
      data-testid="fleet-pulse"
      className="pointer-events-auto w-[300px] rounded-[18px] p-4 shadow-[0_8px_24px_var(--shadow)] glass"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-black tracking-[0.14em] text-text-muted uppercase">
          Fleet pulse
        </span>
        <span
          data-testid="pulse-scope"
          className="ml-auto truncate text-[11px] font-extrabold tracking-[0.1em] text-text-faint uppercase"
        >
          {scopeLabel(filter.fleetIds, names)}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-text-muted transition-transform',
            collapsed && '-rotate-90',
          )}
          aria-hidden
        />
      </button>
      <div className="mt-2.5 flex items-end gap-1.5">
        <span
          data-testid="pulse-total"
          className="text-[40px] leading-none font-black tracking-[0.02em]"
        >
          {formatCount(total)}
        </span>
        <span className="pb-1 text-xs text-text-muted">vehicles</span>
      </div>
      {!collapsed && (
        <>
          <div className="mt-3.5 mb-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-hidden>
            {VEHICLE_STATUSES.map((s) =>
              shown(s) > 0 ? (
                <i
                  key={s}
                  className="block h-full"
                  style={{ flexGrow: shown(s), background: STATUS_META[s].color }}
                />
              ) : null,
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3.5 gap-y-[7px] text-xs">
            {VEHICLE_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-[7px] text-text-muted">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: STATUS_META[s].color }}
                />
                <dt className="truncate">{STATUS_META[s].label}</dt>
                <dd className="ml-auto font-extrabold text-text">{formatCount(shown(s))}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3.5 border-t border-glass-border pt-3">
            <div className="flex items-center text-[11px] font-black tracking-[0.14em] text-text-muted uppercase">
              Running · last hour
              {change !== null && (
                <span
                  data-testid="pulse-change"
                  className={cn(
                    'ml-auto text-xs tracking-normal',
                    change >= 0 ? 'text-ok' : 'text-danger',
                  )}
                >
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
                </span>
              )}
            </div>
            {spark ? (
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                height={H}
                className="mt-1.5"
                role="img"
                aria-label={`Running vehicles, ${pulse.length} samples`}
              >
                <path d={spark.area} fill="var(--st-running)" fillOpacity={0.18} />
                <path d={spark.line} fill="none" stroke="var(--st-running)" strokeWidth={2} />
              </svg>
            ) : (
              <p data-testid="pulse-collecting" className="mt-2 text-xs text-text-faint">
                Collecting…
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
