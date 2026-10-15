import type { Fleet, VehicleMeta } from '@shared/contract/index.ts';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, MoveRight, Search } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { FleetAutoAssignToggle } from '@/features/requests/components/fleet-auto-assign-toggle';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { FleetDialog } from './fleet-dialog';
import { FleetPicker } from './fleet-picker';
import { ancestorsOf, type FleetIndex } from './fleet-tree-model';
import type { FleetVehiclesStore } from './fleet-vehicles-store';
import { useStore, windowOrFirst } from './use-store';

const ROW_H = 40;
/** Load the next page when the last rendered row is this close to the end. */
const PREFETCH_ROWS = 20;
const counts = new Intl.NumberFormat('en-IN');

const VehicleRow = memo(function VehicleRow({
  index,
  start,
  vehicle: v,
  selected,
  onToggle,
}: {
  index: number;
  start: number;
  vehicle: VehicleMeta;
  selected: boolean;
  onToggle: (index: number, range: boolean) => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-vehicle-id={v.vehicleId}
      onClick={(e) => onToggle(index, e.shiftKey)}
      className={cn(
        'absolute inset-x-0 flex cursor-pointer items-center border-b border-glass-border/50 text-sm select-none hover:bg-tile',
        selected && 'bg-accent-soft hover:bg-accent-soft',
      )}
      style={{ height: ROW_H, transform: `translateY(${start}px)` }}
    >
      <div role="gridcell" className="grid w-10 shrink-0 place-items-center">
        <input
          type="checkbox"
          aria-label={`Select ${v.regno}`}
          checked={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(index, e.shiftKey);
          }}
          onChange={() => {}}
          className="size-4 accent-[var(--accent)]"
        />
      </div>
      <div role="gridcell" className="w-[112px] shrink-0 truncate pr-2 font-semibold">
        {v.regno}
      </div>
      <div role="gridcell" className="min-w-0 flex-1 truncate pr-2 text-xs text-text-muted">
        {v.vin}
      </div>
      <div role="gridcell" className="w-[104px] shrink-0 truncate pr-3 text-xs text-text-muted">
        {v.deviceId}
      </div>
    </div>
  );
});

/**
 * F03-R6: the selected fleet's panel. Direct vehicles in cursor pages of 100 (infinite scroll),
 * search by regno / VIN / device ID, multi-select (checkbox, shift-range, select page) and
 * "Move to fleet…".
 */
export function FleetVehicles({
  fleet,
  index,
  store,
  className,
}: {
  fleet: Fleet;
  index: FleetIndex;
  store: FleetVehiclesStore;
  className?: string;
}) {
  const items = useStore(store, (s) => s.items);
  const selected = useStore(store, (s) => s.selected);
  const loading = useStore(store, (s) => s.loading);
  const initial = useStore(store, (s) => s.initial);
  const error = useStore(store, (s) => s.error);
  const nextCursor = useStore(store, (s) => s.nextCursor);
  const moving = useStore(store, (s) => s.moving);
  const storeQuery = useStore(store, (s) => s.query);
  const [draft, setDraft] = useState(storeQuery);
  const [moveOpen, setMoveOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Search is debounced; a new fleet starts from the store's current query.
  useEffect(() => {
    if (draft === storeQuery) return;
    const t = setTimeout(() => store.setQuery(draft), 250);
    return () => clearTimeout(t);
  }, [draft, storeQuery, store]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual (see fleet-tree)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 6,
    initialRect: { width: 420, height: 480 },
  });
  const rows = windowOrFirst(virtualizer.getVirtualItems(), items.length, ROW_H);
  const last = rows.at(-1)?.index ?? -1;

  // Infinite scroll: fetch the next cursor page near the end of what is loaded.
  useEffect(() => {
    if (!initial && nextCursor && !loading && !error && last >= items.length - PREFETCH_ROWS)
      void store.loadMore();
  }, [last, items.length, nextCursor, loading, initial, error, store]);

  const [onToggle] = useState(() => (i: number, range: boolean) => store.toggle(i, range));

  const path = ancestorsOf(index, fleet.id)
    .reverse()
    .map((f) => f.name);
  const direct = index.direct.get(fleet.id) ?? 0;
  const allSelected = items.length > 0 && items.every((v) => selected.has(v.vehicleId));
  const someSelected = selected.size > 0 && !allSelected;

  const confirmMove = async () => {
    if (!target) return;
    if (await store.moveSelected(target)) {
      setMoveOpen(false);
      setTarget(null);
    }
  };

  return (
    <section
      aria-label={`Vehicles in ${fleet.name}`}
      data-testid="fleet-vehicles"
      className={cn('flex min-h-0 flex-col', className)}
    >
      <header className="px-5 pt-5 pb-3">
        {path.length > 0 && (
          <p className="truncate text-[11px] font-bold tracking-[0.06em] text-text-muted uppercase">
            {path.join(' › ')}
          </p>
        )}
        <h2 className="mt-0.5 truncate text-lg font-semibold tracking-[0.04em]">{fleet.name}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-tile border border-tile-border bg-tile px-3 py-2">
            <dt className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
              In subtree
            </dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="fleet-subtree-count">
              {counts.format(fleet.vehicleCount)}
            </dd>
          </div>
          <div className="rounded-tile border border-tile-border bg-tile px-3 py-2">
            <dt className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
              Direct
            </dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="fleet-direct-count">
              {counts.format(direct)}
            </dd>
          </div>
        </dl>
        {/* F14-R4: replacement auto-assign for this fleet (with inheritance). */}
        {!fleet.id.startsWith('tmp-') && (
          <FleetAutoAssignToggle key={fleet.id} fleetId={fleet.id} className="mt-3" />
        )}
        <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-tile-border bg-tile px-3 focus-within:border-accent/60">
          <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search vehicles"
            placeholder="Regno, VIN or device ID"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
          />
        </label>
      </header>
      <div className="flex items-center gap-2 border-y border-glass-border px-3 py-2">
        <label className="flex items-center gap-2 px-1 text-xs font-semibold">
          <input
            type="checkbox"
            aria-label="Select page"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            disabled={items.length === 0}
            onChange={() => store.toggleAll()}
            className="size-4 accent-[var(--accent)]"
          />
          <span data-testid="fleet-selection-count" aria-live="polite">
            {selected.size > 0 ? `${counts.format(selected.size)} selected` : 'Select page'}
          </span>
        </label>
        <Button
          size="sm"
          className="ml-auto"
          disabled={selected.size === 0 || moving}
          onClick={() => setMoveOpen(true)}
        >
          <MoveRight aria-hidden />
          Move to fleet…
        </Button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-testid="vehicle-scroller">
        <div role="grid" aria-label="Direct vehicles" aria-rowcount={items.length + 1}>
          <div role="rowgroup" className="sticky top-0 z-10 bg-surface-solid">
            <div
              role="row"
              aria-rowindex={1}
              className="flex h-8 items-center border-b border-glass-border text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase"
            >
              <span role="columnheader" className="w-10 shrink-0" aria-label="Selected" />
              <span role="columnheader" className="w-[112px] shrink-0">
                Regno
              </span>
              <span role="columnheader" className="flex-1">
                VIN
              </span>
              <span role="columnheader" className="w-[104px] shrink-0">
                Device ID
              </span>
            </div>
          </div>
          <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {rows.map((r) => {
              const v = items[r.index]!;
              return (
                <VehicleRow
                  key={v.vehicleId}
                  index={r.index}
                  start={r.start}
                  vehicle={v}
                  selected={selected.has(v.vehicleId)}
                  onToggle={onToggle}
                />
              );
            })}
          </div>
        </div>
        {error && (
          <div className="flex flex-col items-center gap-2 p-4 text-sm">
            <p className="text-danger">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void store.loadMore()}>
              Retry
            </Button>
          </div>
        )}
        {!error && !loading && !initial && items.length === 0 && (
          <p className="p-6 text-center text-sm text-text-muted">
            {storeQuery ? 'No vehicles match.' : 'No vehicles directly in this fleet.'}
          </p>
        )}
      </div>
      <footer
        className="flex h-9 items-center gap-2 border-t border-glass-border px-4 text-xs text-text-muted"
        data-testid="vehicle-list-status"
      >
        {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {loading
          ? 'Loading vehicles…'
          : `${counts.format(items.length)} loaded${nextCursor ? ' · scroll for more' : ''}`}
      </footer>
      <FleetDialog
        open={moveOpen}
        onOpenChange={(o) => {
          setMoveOpen(o);
          if (!o) setTarget(null);
        }}
        title={`Move ${counts.format(selected.size)} vehicle${selected.size === 1 ? '' : 's'}`}
        description={`From ${fleet.name} to the fleet you choose.`}
        submitLabel={moving ? 'Moving…' : 'Move'}
        submitDisabled={!target || target === fleet.id || moving}
        onSubmit={() => void confirmMove()}
      >
        <FleetPicker
          mode="single"
          fleets={index.fleets}
          value={target}
          onChange={setTarget}
          aria-label="Target fleet"
          placeholder="Choose the target fleet"
        />
      </FleetDialog>
    </section>
  );
}
