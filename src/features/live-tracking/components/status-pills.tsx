import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status';
import { Popover } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { STATUS_META } from '../config/status-meta';
import { formatCompact, formatCount } from '../lib/format-count';
import { fitCount } from '../lib/status-bar-model';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { DESKTOP_QUERY } from './vehicle-details-panel';

const selectStatuses = (s: LiveTrackingState) => s.filter.statuses;
const selectCounts = (s: LiveTrackingState) => s.filteredCounts;
const selectTotal = (s: LiveTrackingState) => s.filteredTotal;

function Pill({ on, className, ...props }: ComponentProps<'button'> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        'flex shrink-0 items-center gap-[7px] rounded-full px-3 text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring [&_b]:font-display [&_b]:font-black [&_b]:tracking-normal [&_b]:text-text',
        on ? 'border border-transparent' : 'glass hover:text-text',
        className,
      )}
      {...props}
    />
  );
}

/**
 * F08-R9: ALL + one pill per status with live filtered counts; clicking toggles the status
 * filter. Desktop collapses what doesn't fit into `+N`; mobile scrolls with short counts.
 */
export function StatusPills({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const statuses = useLiveTracking(selectStatuses, Object.is, store) ?? [];
  const counts = useLiveTracking(selectCounts, Object.is, store);
  const total = useLiveTracking(selectTotal, Object.is, store);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const fmt = desktop ? formatCount : formatCompact;
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number>(VEHICLE_STATUSES.length);
  const [moreOpen, setMoreOpen] = useState(false);

  // Re-fit when the box resizes or the counts (pill widths) change. No layout → show all.
  useLayoutEffect(() => {
    if (!desktop) return;
    const el = box.current;
    const m = measure.current;
    if (!el || !m || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth);
      if (!el.clientWidth || widths.some((w) => !w)) return;
      setVisible(fitCount(widths, el.clientWidth));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, counts, total]);

  const toggle = (s: VehicleStatus | null) => store.toggleStatus(s);
  const pill = (s: VehicleStatus, extra?: string) => {
    const on = statuses.includes(s);
    const { label, color } = STATUS_META[s];
    return (
      <Pill
        key={s}
        on={on}
        data-status={s}
        aria-label={`${label}: ${formatCount(counts[s])}`}
        onClick={() => toggle(s)}
        className={extra}
        style={
          on
            ? {
                background: `color-mix(in srgb, ${color} 22%, transparent)`,
                borderColor: color,
                color,
              }
            : undefined
        }
      >
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        <span className="hidden lg:inline">{label}</span>
        <b style={on ? { color } : undefined}>{fmt(counts[s])}</b>
      </Pill>
    );
  };
  const allOn = statuses.length === 0;
  const all = (
    <Pill
      on={allOn}
      data-status="all"
      aria-label={`All: ${formatCount(total)}`}
      onClick={() => toggle(null)}
      className={cn(allOn && 'bg-accent text-accent-ink [&_b]:text-accent-ink')}
    >
      All <b>{fmt(total)}</b>
    </Pill>
  );
  // Mobile scrolls instead of collapsing.
  const fits = desktop ? visible : VEHICLE_STATUSES.length;
  const shown = VEHICLE_STATUSES.slice(0, fits);
  const hidden = VEHICLE_STATUSES.slice(fits);
  const hiddenOn = hidden.some((s) => statuses.includes(s));

  return (
    <div
      ref={box}
      data-slot="map-status-chips"
      role="group"
      aria-label="Filter by status"
      className="pointer-events-auto relative flex h-9 min-w-0 flex-1 [scrollbar-width:none] gap-1.5 overflow-x-auto lg:h-9 lg:overflow-visible [&>button]:h-[30px] lg:[&>button]:h-9"
    >
      {all}
      {shown.map((s) => pill(s))}
      {hidden.length > 0 && (
        <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <Popover.Trigger asChild>
            <Pill
              on={hiddenOn}
              aria-label={`${hidden.length} more statuses`}
              className={cn('h-9', hiddenOn && 'bg-accent-soft text-accent')}
            >
              +{hidden.length}
            </Pill>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              aria-label="More statuses"
              className="z-50 flex flex-col gap-1.5 rounded-tile border border-glass-border bg-surface-solid p-2 shadow-[0_8px_24px_var(--shadow)] [&>button]:h-9"
            >
              {hidden.map((s) => pill(s))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {/* Invisible copies for measuring pill widths (desktop only). */}
      {desktop && (
        <div
          ref={measure}
          aria-hidden
          className="pointer-events-none invisible absolute top-0 left-0 flex gap-1.5 [&>button]:h-9"
        >
          {all}
          {VEHICLE_STATUSES.map((s) => pill(s))}
        </div>
      )}
    </div>
  );
}
