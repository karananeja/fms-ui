import { EyeOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import type { ParameterGroupId } from '../config/details-config';
import {
  badgesModel,
  cellStrip,
  deviceModel,
  eventItems,
  filterParameters,
  headerModel,
  highlights,
  overviewModel,
  parameterCells,
  ringsModel,
  sessionChart,
} from '../lib/vehicle-details-model';
import {
  hasPermission,
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { DetailsHero } from './details-hero';
import { DeviceTab } from './device-tab';
import { EventsTab } from './events-tab';
import { OverviewTab } from './overview-tab';
import { ParametersTab } from './parameters-tab';
import { RingGauge } from './ring-gauge';

export const DESKTOP_QUERY = '(min-width: 1024px)';
const SNAP_POINTS = [0.35, 0.92];
const NOW_TICK_MS = 5000;

type TabId = 'overview' | 'parameters' | 'device' | 'events';

const selectId = (s: LiveTrackingState) => s.selectedVehicleId;
const selectSelected = (s: LiveTrackingState) => s.selected;
const selectSummary = (s: LiveTrackingState) => s.selectedSummary;
const selectOffset = (s: LiveTrackingState) => s.stats.serverOffsetMs;
const selectHidden = (s: LiveTrackingState) => s.selectedHidden;
const selectCanView = (s: LiveTrackingState) => hasPermission(s, 'vehicle.details.view');
const selectCanParams = (s: LiveTrackingState) => hasPermission(s, 'vehicle.parameters.view');
const selectCanShare = (s: LiveTrackingState) => hasPermission(s, 'share.create');

interface PanelProps {
  store?: LiveTrackingStore;
  /** Render probe for parameter rows (F07-T6). */
  onCellRender?: (pid: string) => void;
}

function NotFound({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <p className="text-sm">Vehicle not available in your fleets</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-[10px] border border-glass-border bg-tile px-3 py-1.5 text-xs font-extrabold"
      >
        Close
      </button>
    </div>
  );
}

function Tabs({
  tab,
  setTab,
  tabs,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  tabs: { id: TabId; label: string; n?: number }[];
}) {
  return (
    <div
      role="tablist"
      aria-label="Vehicle details sections"
      className="mx-4 mt-3 flex gap-0.5 rounded-xl border border-tile-border bg-tile p-[3px]"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`details-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls="details-tabpanel"
          onClick={() => setTab(t.id)}
          className={cn(
            'flex-1 rounded-[9px] py-[7px] text-xs font-extrabold',
            tab === t.id ? 'bg-tile-border text-text' : 'text-text-muted hover:text-text',
          )}
        >
          {t.label}
          {t.n !== undefined && (
            <span className="ml-1 text-accent" data-testid="details-param-count">
              {t.n}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Hero + rings + tabs for the selected vehicle. `scroll` wraps the tab body. */
function DetailsBody({
  store,
  vehicleId,
  compact,
  onCellRender,
  scroll,
}: Required<Pick<PanelProps, 'store'>> &
  Pick<PanelProps, 'onCellRender'> & {
    vehicleId: string;
    compact: boolean;
    scroll: (body: ReactNode) => ReactNode;
  }) {
  const selected = useLiveTracking(selectSelected, Object.is, store);
  const summary = useLiveTracking(selectSummary, Object.is, store);
  const offset = useLiveTracking(selectOffset, Object.is, store);
  const canParams = useLiveTracking(selectCanParams, Object.is, store);
  const canShare = useLiveTracking(selectCanShare, Object.is, store);
  const hidden = useLiveTracking(selectHidden, Object.is, store);
  const now = useNow(NOW_TICK_MS) + offset;
  const [tab, setTab] = useState<TabId>('overview');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<ParameterGroupId>('all');

  const own = selected?.vehicleId === vehicleId ? selected : null;
  const c = own?.combinfo ?? null;
  const l = own?.lafparsed ?? null;
  const status = own?.status ?? null;
  const history = own?.history;
  const ownSummary = summary?.vehicleId === vehicleId ? summary : null;

  const header = useMemo(
    () => headerModel(vehicleId, ownSummary, c, status, now),
    [vehicleId, ownSummary, c, status, now],
  );
  const badges = useMemo(() => c && badgesModel(c), [c]);
  const rings = useMemo(() => ringsModel(c, l), [c, l]);
  const overview = useMemo(() => c && overviewModel(c), [c]);
  const chart = useMemo(() => sessionChart(history?.samples ?? []), [history]);
  const events = useMemo(() => eventItems(history?.events ?? []), [history]);
  const device = useMemo(() => c && deviceModel(c), [c]);
  const cells = useMemo(() => l && cellStrip(l), [l]);
  const params = useMemo(() => l && parameterCells(l), [l]);
  const hl = useMemo(() => (l ? highlights(l) : []), [l]);
  const filtered = useMemo(
    () => params && filterParameters(params, query, group),
    [params, query, group],
  );
  const regno = ownSummary?.regno ?? c?.regno ?? null;
  const share = useMemo(
    () => (canShare && regno ? { vehicleId, regno } : null),
    [canShare, regno, vehicleId],
  );

  const close = () => void store.selectVehicle(null);
  if (own?.found === false) return <NotFound onClose={close} />;

  const active = tab === 'parameters' && !canParams ? 'overview' : tab;
  const tabs: { id: TabId; label: string; n?: number }[] = [
    { id: 'overview', label: 'Overview' },
    ...(canParams
      ? [{ id: 'parameters' as const, label: 'Parameters', n: filtered?.length ?? 0 }]
      : []),
    { id: 'device', label: 'Device' },
    { id: 'events', label: 'Events' },
  ];

  return (
    <>
      {hidden && (
        <p
          role="status"
          data-testid="hidden-by-filters"
          className="mx-4 mt-3 flex items-center gap-2 rounded-tile border border-warn/40 bg-warn/10 px-3 py-2 text-xs font-extrabold tracking-[0.08em] text-warn uppercase"
        >
          <EyeOff className="size-4" aria-hidden />
          Hidden by filters
        </p>
      )}
      <DetailsHero
        header={header}
        badges={badges}
        compact={compact}
        onLocate={() => void store.locateVehicle(vehicleId)}
        onClose={close}
      />
      <div className="grid grid-cols-3 gap-2 px-4">
        <RingGauge ring={rings.battery} label="Battery" size={compact ? 56 : 70} />
        <RingGauge ring={rings.range} label="Range" size={compact ? 56 : 70} />
        <RingGauge ring={rings.health} label="Health" size={compact ? 56 : 70} />
      </div>
      <Tabs tab={active} setTab={setTab} tabs={tabs} />
      {scroll(
        <div
          id="details-tabpanel"
          role="tabpanel"
          aria-labelledby={`details-tab-${active}`}
          className="flex flex-col gap-2.5 px-4 pt-3 pb-4"
        >
          {active === 'overview' && (
            <OverviewTab overview={overview} chart={chart} events={events} share={share} />
          )}
          {active === 'parameters' && (
            <ParametersTab
              cells={filtered}
              total={params?.length ?? 0}
              highlights={hl}
              query={query}
              setQuery={setQuery}
              group={group}
              setGroup={setGroup}
              onCellRender={onCellRender}
            />
          )}
          {active === 'device' && <DeviceTab device={device} cells={cells} />}
          {active === 'events' && <EventsTab items={events} />}
        </div>,
      )}
    </>
  );
}

function DesktopPanel({ store, vehicleId, onCellRender }: PanelProps & { vehicleId: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [vehicleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) void store!.selectVehicle(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store]);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label="Vehicle details"
      data-details-panel="card"
      className="absolute top-[72px] right-3.5 bottom-3.5 z-20 flex w-[420px] flex-col overflow-hidden rounded-[var(--radius-panel)] shadow-[0_30px_80px_rgb(0_0_0/0.55)] glass outline-none"
    >
      <DetailsBody
        store={store!}
        vehicleId={vehicleId}
        compact={false}
        onCellRender={onCellRender}
        scroll={(body) => <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>}
      />
    </section>
  );
}

function MobileSheet({ store, vehicleId, onCellRender }: PanelProps & { vehicleId: string }) {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]!);
  const top = snap === SNAP_POINTS[1];
  return (
    <Drawer
      open
      modal={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      onOpenChange={(open) => !open && void store!.selectVehicle(null)}
    >
      <DrawerContent
        aria-label="Vehicle details"
        data-details-panel="sheet"
        data-snap={snap ?? ''}
        className="max-h-none bg-glass glass"
      >
        <DrawerTitle className="sr-only">Vehicle details</DrawerTitle>
        <DrawerDescription className="sr-only">
          Live details of the selected vehicle
        </DrawerDescription>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            top ? 'overflow-y-auto' : 'overflow-hidden',
          )}
        >
          <DetailsBody
            store={store!}
            vehicleId={vehicleId}
            compact
            onCellRender={onCellRender}
            scroll={(body) => body}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Selected vehicle's details: glass card on desktop, bottom sheet below 1024 px (F07). */
export function VehicleDetailsPanel({ store = liveTrackingStore, onCellRender }: PanelProps) {
  const vehicleId = useLiveTracking(selectId, Object.is, store);
  const canView = useLiveTracking(selectCanView, Object.is, store);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (!vehicleId || !canView) return null;
  const Panel = desktop ? DesktopPanel : MobileSheet;
  return <Panel key={vehicleId} store={store} vehicleId={vehicleId} onCellRender={onCellRender} />;
}
