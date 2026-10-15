import type { Fleet } from '@shared/contract/index.ts';
import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { Button } from '@/shared/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import { AdminLayout } from '../components/admin-layout';
import { FleetDialog } from './fleet-dialog';
import { FleetPicker } from './fleet-picker';
import { FleetTree, type FleetAction } from './fleet-tree';
import { maxParentDepthFor } from './fleet-tree-model';
import { FleetTreeStore, type FleetApi, type Notifier } from './fleet-tree-store';
import { FleetVehicles } from './fleet-vehicles';
import { FleetVehiclesStore } from './fleet-vehicles-store';
import { useStore } from './use-store';

const DESKTOP_QUERY = '(min-width: 1024px)';
const counts = new Intl.NumberFormat('en-IN');

type Pending = { action: FleetAction; fleet: Fleet } | null;

/** Add child / move / delete dialogs for the fleet chosen in a row menu. */
function FleetActionDialogs({
  pending,
  onClose,
  store,
}: {
  pending: Pending;
  onClose: () => void;
  store: FleetTreeStore;
}) {
  const index = useStore(store, (s) => s.index);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const fleet = pending?.fleet;
  const close = () => {
    setName('');
    setParent(null);
    onClose();
  };

  return (
    <>
      <FleetDialog
        open={pending?.action === 'add'}
        onOpenChange={(o) => !o && close()}
        title="Add child fleet"
        description={fleet && `Inside ${fleet.name}.`}
        submitLabel="Add fleet"
        submitDisabled={!name.trim()}
        onSubmit={() => {
          if (fleet) void store.create(fleet.id, name);
          close();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs font-semibold tracking-[0.08em] text-text-muted uppercase">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded-md border border-tile-border bg-tile px-3 text-sm font-bold tracking-normal text-text normal-case outline-none focus:border-accent/60"
          />
        </label>
      </FleetDialog>
      <FleetDialog
        open={pending?.action === 'move'}
        onOpenChange={(o) => !o && close()}
        title={fleet ? `Move ${fleet.name}` : 'Move fleet'}
        description="Choose the new parent. Its own subtree and parents that would nest it deeper than 5 levels aren't offered."
        submitLabel="Move"
        submitDisabled={!parent || parent === fleet?.parentId}
        onSubmit={() => {
          if (fleet && parent) void store.move(fleet.id, parent);
          close();
        }}
      >
        {fleet && (
          <FleetPicker
            mode="single"
            fleets={index.fleets}
            value={parent}
            onChange={setParent}
            excludeSubtreeOf={fleet.id}
            maxDepth={maxParentDepthFor(index, fleet.id)}
            aria-label="New parent"
            placeholder="Choose the new parent"
          />
        )}
      </FleetDialog>
      <FleetDialog
        open={pending?.action === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={fleet ? `Delete ${fleet.name}?` : 'Delete fleet?'}
        description="The fleet is empty and has no child fleets. This can't be undone."
        submitLabel="Delete"
        destructive
        onSubmit={() => {
          if (fleet) void store.remove(fleet.id);
          close();
        }}
      />
    </>
  );
}

/**
 * `/admin/fleets` (F03-R4…R6): the fleet tree beside the selected fleet's vehicles (a 420 px
 * `surface-solid` panel on desktop, a bottom sheet on mobile).
 */
export function FleetsPage({ api, notify }: { api?: FleetApi; notify?: Notifier } = {}) {
  const [tree] = useState(() => new FleetTreeStore(api, notify));
  const [vehicles] = useState(() => new FleetVehiclesStore(api, notify, tree.refresh));
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const status = useStore(tree, (s) => s.status);
  const error = useStore(tree, (s) => s.error);
  const index = useStore(tree, (s) => s.index);
  const selectedId = useStore(tree, (s) => s.selectedId);
  const query = useStore(tree, (s) => s.query);
  const [pending, setPending] = useState<Pending>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void tree.load();
  }, [tree]);

  // Temporary ids (optimistic create) have no vehicles to list yet.
  const listId = selectedId && !selectedId.startsWith('tmp-') ? selectedId : null;
  useEffect(() => {
    vehicles.open(listId);
  }, [vehicles, listId]);

  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const panel = selected && (
    <FleetVehicles fleet={selected} index={index} store={vehicles} className="h-full" />
  );

  return (
    <AdminLayout
      title="Fleets"
      description="Your fleet tree and the vehicles in each fleet."
      className="lg:h-[calc(100dvh-56px)]"
    >
      <div className="flex min-h-0 flex-1 gap-4">
        <section
          aria-label="Fleets"
          className="flex h-[calc(100dvh-210px)] min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-panel)] glass lg:h-auto"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-glass-border p-3">
            <label className="flex h-9 min-w-0 flex-1 basis-48 items-center gap-2 rounded-md border border-tile-border bg-tile px-3 focus-within:border-accent/60">
              <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
              <input
                type="search"
                aria-label="Search fleets"
                placeholder="Search fleets"
                value={query}
                onChange={(e) => tree.setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              aria-label="Expand all"
              title="Expand all"
              onClick={() => tree.expandAll()}
            >
              <ChevronsUpDown aria-hidden />
              <span className="hidden sm:inline">Expand all</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Collapse all"
              title="Collapse all"
              onClick={() => tree.collapseAll()}
            >
              <ChevronsDownUp aria-hidden />
              <span className="hidden sm:inline">Collapse all</span>
            </Button>
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-glass-border px-4 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            <span data-testid="fleet-total">{counts.format(index.fleets.length)} fleets</span>
            <span className="pr-10">Vehicles</span>
          </div>
          {status === 'error' ? (
            <div className="flex flex-col items-center gap-3 p-6 text-sm">
              <p className="text-danger">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void tree.load()}>
                Retry
              </Button>
            </div>
          ) : status !== 'ready' ? (
            <p className="p-6 text-center text-sm text-text-muted">Loading fleets…</p>
          ) : (
            <FleetTree
              store={tree}
              className="flex-1"
              onActivate={() => !desktop && setSheetOpen(true)}
              onAction={(action, fleet) => setPending({ action, fleet })}
            />
          )}
        </section>
        {desktop && panel && (
          <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid shadow-float">
            {panel}
          </aside>
        )}
      </div>
      {!desktop && (
        <Drawer open={sheetOpen && !!panel} onOpenChange={setSheetOpen}>
          <DrawerContent className="h-[85dvh] bg-surface-solid">
            <DrawerTitle className="sr-only">{selected?.name ?? 'Fleet'} vehicles</DrawerTitle>
            <DrawerDescription className="sr-only">
              Direct vehicles of the selected fleet
            </DrawerDescription>
            {panel}
          </DrawerContent>
        </Drawer>
      )}
      <FleetActionDialogs pending={pending} onClose={() => setPending(null)} store={tree} />
    </AdminLayout>
  );
}
