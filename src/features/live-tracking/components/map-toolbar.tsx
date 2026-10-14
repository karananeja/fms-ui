import { Building2, Maximize, Minus, Plus, Table2 } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState, useSyncExternalStore, type ComponentProps, type FormEvent } from 'react';
import { cn } from '@/shared/lib/utils';
import { INDIA_CITIES, type IndiaCity } from '../config/india-cities';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { mapView } from '../store/map-view';
import { useLiveTracking } from '../store/use-live-tracking';

const selectHasVehicles = (s: LiveTrackingState) => s.total > 0;

function CitySelect() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const cities = q
    ? INDIA_CITIES.filter((c) => c.name.toLowerCase().includes(q) || c.state.toLowerCase() === q)
    : INDIA_CITIES;
  const choose = (city: IndiaCity) => {
    liveTrackingStore.jumpToCity(city);
    setOpen(false);
    setQuery('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cities[0]) choose(cities[0]);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          className="flex h-12 items-center gap-2 rounded-tile px-3.5 text-xs font-extrabold tracking-[0.12em] text-text-muted uppercase shadow-[0_8px_24px_var(--shadow)] glass outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Building2 className="size-4" aria-hidden />
          <span className="tracking-normal normal-case">Jump to city…</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={8}
          className="z-50 w-60 rounded-tile border border-glass-border bg-glass-strong p-2 shadow-[0_8px_24px_var(--shadow)]"
        >
          <form onSubmit={submit}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city"
              aria-label="Search city"
              className="h-9 w-full rounded-md border border-tile-border bg-tile px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
          <ul role="listbox" aria-label="Cities" className="mt-2 max-h-64 overflow-auto">
            {cities.map((city) => (
              <li key={city.name} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => choose(city)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent focus-visible:outline-none"
                >
                  {city.name}
                  <span className="text-xs text-text-muted">{city.state}</span>
                </button>
              </li>
            ))}
            {!cities.length && <li className="px-2 py-1.5 text-sm text-text-muted">No match</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Tool({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'grid size-9 place-items-center rounded-[10px] text-xs font-black text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-accent [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Bottom-left map tools (DS1-R7/R10): zoom, fit, 2D/3D (desktop only), the table view (F09-R1)
 * and the city jump.
 */
export function MapToolbar({ onTable }: { onTable?: () => void }) {
  const hasVehicles = useLiveTracking(selectHasVehicles);
  const is3d = useSyncExternalStore(mapView.subscribe, mapView.get3d);
  return (
    <div className="absolute bottom-12 left-3.5 z-10 flex items-end gap-2">
      <div
        role="toolbar"
        aria-label="Map tools"
        aria-orientation="vertical"
        className="flex flex-col gap-1 rounded-tile p-1.5 shadow-[0_8px_24px_var(--shadow)] glass"
      >
        <Tool aria-label="Zoom in" title="Zoom in" onClick={() => mapView.zoom(1)}>
          <Plus aria-hidden />
        </Tool>
        <Tool aria-label="Zoom out" title="Zoom out" onClick={() => mapView.zoom(-1)}>
          <Minus aria-hidden />
        </Tool>
        <Tool
          aria-label="Zoom to fit"
          title="Zoom to fit all vehicles"
          disabled={!hasVehicles}
          onClick={() => void liveTrackingStore.fitToVehicles()}
        >
          <Maximize aria-hidden />
        </Tool>
        <Tool
          className="hidden lg:grid"
          aria-label="3D view"
          title={is3d ? 'Switch to 2D' : 'Switch to 3D'}
          aria-pressed={is3d}
          onClick={() => mapView.set3d(!is3d)}
        >
          3D
        </Tool>
        {onTable && (
          <Tool aria-label="Table view" title="Show as a table" onClick={onTable}>
            <Table2 aria-hidden />
          </Tool>
        )}
      </div>
      <CitySelect />
    </div>
  );
}
