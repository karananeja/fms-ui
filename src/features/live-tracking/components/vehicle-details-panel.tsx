import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import {
  deviceModel,
  drivingEnergyModel,
  filterParameters,
  headerModel,
  locationModel,
  parameterCells,
} from '../lib/vehicle-details-model';
import {
  hasPermission,
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { DetailsHeader } from './details-header';
import { SectionLabel, Skeleton } from './details-ui';
import { DeviceCommsCard } from './device-comms-card';
import { DrivingEnergyCard } from './driving-energy-card';
import { ExpandedDetails } from './expanded-details';
import { LocationRow } from './location-row';
import { ParameterSearch, ParametersGrid } from './parameters-grid';

export const DESKTOP_QUERY = '(min-width: 1024px)';
const SNAP_POINTS = [0.35, 0.92];

const selectId = (s: LiveTrackingState) => s.selectedVehicleId;
const selectSelected = (s: LiveTrackingState) => s.selected;
const selectSummary = (s: LiveTrackingState) => s.selectedSummary;
const selectOffset = (s: LiveTrackingState) => s.stats.serverOffsetMs;
const selectCanView = (s: LiveTrackingState) => hasPermission(s, 'vehicle.details.view');
const selectCanParams = (s: LiveTrackingState) => hasPermission(s, 'vehicle.parameters.view');

interface PanelProps {
  store?: LiveTrackingStore;
  /** Render probe for parameter cells (F07-T5). */
  onCellRender?: (pid: string) => void;
}

function Section({
  label,
  action,
  children,
}: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t px-5 py-4">
      {label && (
        <div className="flex min-h-8 items-center justify-between">
          <SectionLabel>{label}</SectionLabel>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function NotFound({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <p className="text-sm">Vehicle not available in your fleets</p>
      <Button variant="secondary" size="sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function ParamCount({ n }: { n: number }) {
  return (
    <SectionLabel>
      Parameters <span data-testid="details-param-count">({n})</span>
    </SectionLabel>
  );
}

/** Panel content for the selected vehicle; `expanded` switches to gauges + parameters grid. */
function DetailsBody({
  store,
  vehicleId,
  expanded,
  setExpanded,
  wide,
  onCellRender,
}: Required<Pick<PanelProps, 'store'>> &
  Pick<PanelProps, 'onCellRender'> & {
    vehicleId: string;
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
    /** Desktop expanded = two columns; otherwise stacked. */
    wide: boolean;
  }) {
  const selected = useLiveTracking(selectSelected, Object.is, store);
  const summary = useLiveTracking(selectSummary, Object.is, store);
  const offset = useLiveTracking(selectOffset, Object.is, store);
  const canParams = useLiveTracking(selectCanParams, Object.is, store);
  const now = useNow(5000) + offset;
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const own = selected?.vehicleId === vehicleId ? selected : null;
  const c = own?.combinfo ?? null;
  const l = own?.lafparsed ?? null;
  const status = own?.status ?? null;
  const ownSummary = summary?.vehicleId === vehicleId ? summary : null;

  const header = useMemo(
    () => headerModel(vehicleId, ownSummary, c, status, now),
    [vehicleId, ownSummary, c, status, now],
  );
  const energy = useMemo(() => c && drivingEnergyModel(c, l), [c, l]);
  const device = useMemo(() => c && deviceModel(c), [c]);
  const location = useMemo(() => c && locationModel(c), [c]);
  const cells = useMemo(() => l && parameterCells(l), [l]);
  const filtered = useMemo(() => cells && filterParameters(cells, query), [cells, query]);

  const close = () => void store.selectVehicle(null);
  if (own?.found === false) return <NotFound onClose={close} />;

  const head = (
    <DetailsHeader
      header={header}
      onLocate={() => void store.locateVehicle(vehicleId)}
      onClose={close}
    />
  );
  const deviceSection = (
    <Section label="Device & Comms">
      {device ? <DeviceCommsCard data={device} /> : <Skeleton className="h-28" label="device" />}
    </Section>
  );
  const locationSection = (
    <Section label="Location">
      {location ? (
        <LocationRow location={location} />
      ) : (
        <Skeleton className="h-6" label="location" />
      )}
    </Section>
  );
  const grid = filtered ? (
    <ParametersGrid cells={filtered} variant="grid" onCellRender={onCellRender} />
  ) : (
    <Skeleton className="h-40" label="parameters" />
  );
  const expand = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Expand view"
      className="ml-auto text-text-muted"
      onClick={() => setExpanded(true)}
    >
      <ChevronsLeft />
    </Button>
  );
  const collapse = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Collapse view"
      className="text-text-muted"
      onClick={() => setExpanded(false)}
    >
      <ChevronsRight />
    </Button>
  );

  if (!expanded) {
    return (
      <>
        {head}
        <Section label="Driving · Energy" action={!canParams && expand}>
          {energy ? (
            <DrivingEnergyCard data={energy} />
          ) : (
            <Skeleton className="h-36" label="energy" />
          )}
        </Section>
        {canParams && (
          <Section>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={listOpen}
                aria-controls="details-param-list"
                onClick={() => setListOpen(!listOpen)}
                className="flex items-center gap-1.5 rounded-sm text-left"
              >
                <ParamCount n={filtered?.length ?? 0} />
                <ChevronDown
                  className={cn(
                    'size-4 text-text-muted transition-transform',
                    listOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
              {expand}
            </div>
            {listOpen && (
              <div id="details-param-list" className="flex flex-col gap-2">
                <ParameterSearch value={query} onChange={setQuery} />
                <div className="max-h-80 overflow-y-auto pr-1">
                  {filtered ? (
                    <ParametersGrid cells={filtered} variant="list" onCellRender={onCellRender} />
                  ) : (
                    <Skeleton className="h-40" label="parameters" />
                  )}
                </div>
              </div>
            )}
          </Section>
        )}
        {deviceSection}
        {locationSection}
      </>
    );
  }

  const gauges = (
    <Section>
      {energy ? <ExpandedDetails data={energy} /> : <Skeleton className="h-72" label="gauges" />}
    </Section>
  );
  const paramsHeader = (
    <div className="flex flex-wrap items-center gap-3">
      <ParamCount n={filtered?.length ?? 0} />
      <ParameterSearch value={query} onChange={setQuery} className="ml-auto w-full max-w-sm" />
      {collapse}
    </div>
  );

  if (!wide) {
    return (
      <>
        {head}
        {gauges}
        {!canParams && <div className="flex justify-end px-5">{collapse}</div>}
        {canParams && (
          <Section>
            {paramsHeader}
            {grid}
          </Section>
        )}
        {deviceSection}
        {locationSection}
      </>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-h-0 overflow-y-auto border-r">
        {head}
        {gauges}
        {deviceSection}
        {locationSection}
      </div>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {canParams ? (
          <>
            {paramsHeader}
            {grid}
          </>
        ) : (
          <div className="flex justify-end">{collapse}</div>
        )}
      </div>
    </div>
  );
}

function DesktopPanel({ store, vehicleId, onCellRender }: PanelProps & { vehicleId: string }) {
  const ref = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);

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
      data-details-panel={expanded ? 'expanded' : 'compact'}
      className={cn(
        'absolute top-14 right-3 bottom-3 z-20 flex flex-col rounded-[var(--radius-panel)] border bg-surface-1 shadow-2xl outline-none',
        expanded ? 'left-3 overflow-hidden' : 'w-[420px] overflow-y-auto',
      )}
    >
      <DetailsBody
        store={store!}
        vehicleId={vehicleId}
        expanded={expanded}
        setExpanded={setExpanded}
        wide
        onCellRender={onCellRender}
      />
    </section>
  );
}

function MobileSheet({ store, vehicleId, onCellRender }: PanelProps & { vehicleId: string }) {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]!);
  const [expanded, setExpanded] = useState(false);
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
        data-details-panel={expanded ? 'expanded' : 'compact'}
        data-snap={snap ?? ''}
      >
        <DrawerTitle className="sr-only">Vehicle details</DrawerTitle>
        <DrawerDescription className="sr-only">
          Live details of the selected vehicle
        </DrawerDescription>
        <div className={cn('min-h-0 flex-1', top ? 'overflow-y-auto' : 'overflow-hidden')}>
          <DetailsBody
            store={store!}
            vehicleId={vehicleId}
            expanded={expanded}
            setExpanded={(x) => {
              setExpanded(x);
              if (x) setSnap(SNAP_POINTS[1]!);
            }}
            wide={false}
            onCellRender={onCellRender}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Selected vehicle's details: floating card on desktop, bottom sheet below 1024 px (F07). */
export function VehicleDetailsPanel({ store = liveTrackingStore, onCellRender }: PanelProps) {
  const vehicleId = useLiveTracking(selectId, Object.is, store);
  const canView = useLiveTracking(selectCanView, Object.is, store);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (!vehicleId || !canView) return null;
  const Panel = desktop ? DesktopPanel : MobileSheet;
  return <Panel key={vehicleId} store={store} vehicleId={vehicleId} onCellRender={onCellRender} />;
}
