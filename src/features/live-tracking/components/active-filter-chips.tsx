import { X } from 'lucide-react';
import { useMemo } from 'react';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { filterChips } from '../lib/status-bar-model';

const selectFilter = (s: LiveTrackingState) => s.filter;
const selectFleets = (s: LiveTrackingState) => s.fleets;

/** F08-R12: removable chips for the active filter plus "Clear all"; hidden when empty. */
export function ActiveFilterChips({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const filter = useLiveTracking(selectFilter, Object.is, store);
  const fleets = useLiveTracking(selectFleets, Object.is, store);
  const names = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);
  const chips = filterChips(filter, names);
  if (!chips.length) return null;
  return (
    <ul
      aria-label="Active filters"
      data-testid="active-filters"
      className="pointer-events-auto flex flex-wrap items-center gap-1.5"
    >
      {chips.map((c) => (
        <li
          key={c.key}
          className="flex h-8 items-center gap-1 rounded-full pr-1 pl-3 text-xs font-extrabold glass"
        >
          {c.label}
          <button
            type="button"
            aria-label={`Remove ${c.label}`}
            onClick={() => store.setFilter(c.without)}
            className="grid size-6 place-items-center rounded-full text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() => store.clearFilter()}
          className="h-8 rounded-full px-3 text-xs font-extrabold tracking-[0.08em] text-accent uppercase outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}
