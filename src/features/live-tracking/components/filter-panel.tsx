import type { Fleet } from '@shared/contract/index';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Popover, Slider } from 'radix-ui';
import { useMemo, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { applyDraft, draftFrom, panelFilterCount, type PanelDraft } from '../lib/status-bar-model';
import { DESKTOP_QUERY } from './vehicle-details-panel';

const toggled = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** Fleets in tree order (parent before children) with their ancestors, for search + rendering. */
function fleetTree(fleets: readonly Fleet[]) {
  const ids = new Set(fleets.map((f) => f.id));
  const children = new Map<string | null, Fleet[]>();
  for (const f of fleets) {
    const p = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    children.set(p, [...(children.get(p) ?? []), f]);
  }
  const out: { fleet: Fleet; level: number; ancestors: string[] }[] = [];
  const walk = (p: string | null, level: number, ancestors: string[]) => {
    for (const f of (children.get(p) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ fleet: f, level, ancestors });
      walk(f.id, level + 1, [...ancestors, f.id]);
    }
  };
  walk(null, 0, []);
  return out;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[11px] font-black tracking-[0.14em] text-text-muted uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ToggleList({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string;
  values: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (!values.length)
    return <p className="text-xs text-text-faint">No {label.toLowerCase()} yet</p>;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(v)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-tile-border bg-tile text-text-muted hover:text-text',
            )}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

function FleetTree({
  fleets,
  selected,
  onToggle,
}: {
  fleets: readonly Fleet[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const tree = useMemo(() => fleetTree(fleets), [fleets]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return tree;
    const keep = new Set<string>();
    for (const n of tree)
      if (n.fleet.name.toLowerCase().includes(q))
        [...n.ancestors, n.fleet.id].forEach((id) => keep.add(id));
    return tree.filter((n) => keep.has(n.fleet.id));
  }, [tree, q]);
  if (!fleets.length) return <p className="text-xs text-text-faint">No fleets available</p>;
  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search fleets"
        aria-label="Search fleets"
        className="h-9 rounded-md border border-tile-border bg-tile px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <ul role="tree" aria-label="Fleets" className="max-h-52 overflow-auto">
        {visible.map(({ fleet, level, ancestors }) => {
          const inherited = ancestors.some((a) => selected.includes(a));
          const on = inherited || selected.includes(fleet.id);
          return (
            <li key={fleet.id} role="treeitem" aria-level={level + 1} aria-selected={on}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-tile',
                  inherited && 'cursor-default opacity-60',
                )}
                style={{ paddingLeft: 6 + level * 16 }}
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  disabled={inherited}
                  onChange={() => onToggle(fleet.id)}
                />
                <span
                  aria-hidden
                  className={cn(
                    'grid size-4 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                    on ? 'border-accent bg-accent text-accent-ink' : 'border-tile-border',
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="truncate">{fleet.name}</span>
                <span className="ml-auto text-xs text-text-faint">{fleet.vehicleCount}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const selectFilter = (s: LiveTrackingState) => s.filter;
const selectOptions = (s: LiveTrackingState) => s.filterOptions;
const selectFleets = (s: LiveTrackingState) => s.fleets;

function PanelBody({ store, onDone }: { store: LiveTrackingStore; onDone: () => void }) {
  const filter = useLiveTracking(selectFilter, Object.is, store);
  const options = useLiveTracking(selectOptions, Object.is, store);
  const fleets = useLiveTracking(selectFleets, Object.is, store);
  const [d, setD] = useState(() => draftFrom(filter));
  const patch = (p: Partial<PanelDraft>) => setD((x) => ({ ...x, ...p }));
  const models = useMemo(() => {
    const all = options?.models ?? [];
    const narrowed = d.makes.length ? all.filter((m) => d.makes.includes(m.make)) : all;
    return [...new Set(narrowed.map((m) => m.model))];
  }, [options, d.makes]);

  return (
    <form
      aria-label="Vehicle filters"
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        store.setFilter(applyDraft(filter, d, options));
        onDone();
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Section title="Fleet">
          <FleetTree
            fleets={fleets}
            selected={d.fleetIds}
            onToggle={(id) => patch({ fleetIds: toggled(d.fleetIds, id) })}
          />
        </Section>
        <Section title="Asset type">
          <ToggleList
            label="Asset types"
            values={options?.assetTypes ?? []}
            selected={d.assetTypes}
            onToggle={(v) => patch({ assetTypes: toggled(d.assetTypes, v) })}
          />
        </Section>
        <Section title="Fuel type">
          <ToggleList
            label="Fuel types"
            values={options?.fuelTypes ?? []}
            selected={d.fuelTypes}
            onToggle={(v) => patch({ fuelTypes: toggled(d.fuelTypes, v) })}
          />
        </Section>
        <Section title="Make">
          <ToggleList
            label="Makes"
            values={options?.makes ?? []}
            selected={d.makes}
            onToggle={(v) => patch({ makes: toggled(d.makes, v) })}
          />
        </Section>
        <Section title="Model">
          <ToggleList
            label="Models"
            values={models}
            selected={d.models}
            onToggle={(v) => patch({ models: toggled(d.models, v) })}
          />
        </Section>
        <Section title={`SOC ${d.soc[0]}–${d.soc[1]}%`}>
          <Slider.Root
            min={0}
            max={100}
            step={1}
            minStepsBetweenThumbs={0}
            value={d.soc}
            onValueChange={(v) => patch({ soc: [v[0]!, v[1]!] })}
            className="relative flex h-6 touch-none items-center select-none"
          >
            <Slider.Track className="relative h-1.5 grow rounded-full bg-tile">
              <Slider.Range className="absolute h-full rounded-full bg-accent" />
            </Slider.Track>
            {(['Minimum SOC', 'Maximum SOC'] as const).map((label) => (
              <Slider.Thumb
                key={label}
                aria-label={label}
                className="block size-5 rounded-full border-2 border-accent bg-surface-solid outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ))}
          </Slider.Root>
        </Section>
      </div>
      <div className="flex gap-2 border-t border-glass-border p-3">
        <button
          type="button"
          onClick={() => setD(draftFrom({}))}
          className="h-10 flex-1 rounded-tile border border-tile-border text-xs font-extrabold tracking-[0.1em] text-text-muted uppercase outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reset
        </button>
        <button
          type="submit"
          className="h-10 flex-1 rounded-tile bg-accent text-xs font-black tracking-[0.1em] text-accent-ink uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

/** F08-R11: Filters button with a glass popover (desktop) or a bottom sheet (mobile). */
export function FilterPanel({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const filter = useLiveTracking(selectFilter, Object.is, store);
  const n = panelFilterCount(filter);
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) void store.loadFilterOptions();
  };
  const trigger = (
    <button
      type="button"
      aria-label={n ? `Filters (${n} active)` : 'Filters'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={desktop ? undefined : () => onOpenChange(true)}
      className={cn(
        'pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-[14px] px-3 text-xs font-extrabold tracking-[0.1em] uppercase shadow-[0_8px_24px_var(--shadow)] glass outline-none focus-visible:ring-2 focus-visible:ring-ring',
        n ? 'text-accent' : 'text-text-muted hover:text-text',
      )}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      <span className="hidden lg:inline">Filters</span>
      {n > 0 && (
        <span className="grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-black text-accent-ink">
          {n}
        </span>
      )}
    </button>
  );

  if (desktop) {
    return (
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            aria-label="Filters"
            data-filter-panel="popover"
            className="z-50 flex max-h-[min(640px,calc(100vh-120px))] w-[360px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid shadow-[0_30px_80px_rgb(0_0_0/0.55)]"
          >
            <PanelBody store={store} onDone={() => setOpen(false)} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <>
      {trigger}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent data-filter-panel="sheet" className="max-h-[90%] bg-surface-solid">
          <DrawerTitle className="px-4 pt-3 text-sm font-black tracking-[0.12em] uppercase">
            Filters
          </DrawerTitle>
          <DrawerDescription className="sr-only">Filter the vehicles on the map</DrawerDescription>
          <PanelBody store={store} onDone={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>
    </>
  );
}
