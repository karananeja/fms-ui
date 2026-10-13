import { Building2, Maximize } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { INDIA_CITIES, type IndiaCity } from '../config/india-cities';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
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
        <Button variant="secondary" size="sm" className="shadow-md" aria-haspopup="listbox">
          <Building2 aria-hidden />
          Jump to city…
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-md border bg-surface-1 p-2 shadow-lg"
        >
          <form onSubmit={submit}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city"
              aria-label="Search city"
              className="h-8 w-full rounded-md border bg-surface-2 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
          <ul role="listbox" aria-label="Cities" className="mt-2 max-h-64 overflow-auto">
            {cities.map((city) => (
              <li key={city.name} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => choose(city)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
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

/** Top-right map actions: zoom to fit, city jump. */
export function MapToolbar() {
  const hasVehicles = useLiveTracking(selectHasVehicles);
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
      <Button
        variant="secondary"
        size="icon-sm"
        className="shadow-md"
        aria-label="Zoom to fit"
        title="Zoom to fit all vehicles"
        disabled={!hasVehicles}
        onClick={() => void liveTrackingStore.fitToVehicles()}
      >
        <Maximize aria-hidden />
      </Button>
      <CitySelect />
    </div>
  );
}
