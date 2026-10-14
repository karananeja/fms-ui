import { useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { cn } from '@/shared/lib/utils';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useLiveView } from '../hooks/use-live-view';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { useSelectionUrlSync } from '../hooks/use-selection-url-sync';
import { ActiveFilterChips } from './active-filter-chips';
import { DebugOverlay } from './debug-overlay';
import { FilterPanel } from './filter-panel';
import { FleetPulseCard } from './fleet-pulse-card';
import { HeadingCompass } from './heading-compass';
import { LiveMap } from './live-map';
import { LivePill } from './live-pill';
import { MapToolbar } from './map-toolbar';
import { SearchBox } from './search-box';
import { StatusPills } from './status-pills';
import { TableView } from './table-view';
import { DESKTOP_QUERY, VehicleDetailsPanel } from './vehicle-details-panel';
import { VehicleTray } from './vehicle-tray';

const NOTICE_MS = 3000;
const selectNotice = (s: LiveTrackingState) => s.notice;

function MapNotice() {
  const notice = useLiveTracking(selectNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => liveTrackingStore.dismissNotice(notice.id), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center px-4"
    >
      {notice && (
        <p className="rounded-tile border-l-2 border-l-accent px-4 py-2.5 text-sm shadow-[0_8px_24px_var(--shadow)] glass">
          {notice.message}
        </p>
      )}
    </div>
  );
}

/** F08 search, filters, pills and LIVE pill: one row on desktop; on mobile a search row, then pills. */
function StatusBarRow({ desktop }: { desktop: boolean }) {
  return desktop ? (
    <div className="flex items-center gap-2.5">
      <SearchBox />
      <FilterPanel />
      <StatusPills />
      <LivePill />
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchBox />
        <FilterPanel />
        <LivePill compact />
      </div>
      <StatusPills />
    </div>
  );
}

/**
 * `/live-tracking`: full-bleed live map with its toolbar (F06), the details panel (F07), the
 * status bar: search, filters, status pills, active chips and fleet pulse (F08), and the
 * table view + vehicle tray (F09).
 */
export function LiveTrackingPage() {
  useSelectionUrlSync();
  const [view, setView] = useLiveView();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const table = view === 'table';
  /** F09-R9: Locate from a table row returns to the map and flies to the vehicle. */
  const locate = (vehicleId: string) => {
    setView('map');
    void liveTrackingStore.locateVehicle(vehicleId);
  };
  const debug = useSearch({
    strict: false,
    select: (s) => String((s as { debug?: unknown }).debug) === '1',
  });
  return (
    <div className="live-tracking relative h-full overflow-hidden">
      <h1 className="sr-only">Live tracking</h1>
      {/* F09-R1: the map stays mounted under the table (instant return), just hidden. */}
      <div className={cn('h-full', table && 'invisible')} aria-hidden={table || undefined}>
        <LiveMap />
      </div>
      <div className="fms-vignette pointer-events-none absolute inset-0" aria-hidden />
      {/* DS1-R3 slots, filled by F08: desktop = one row; mobile = search row, then pills. */}
      {table ? (
        /* Integration (D-074): in table view the status bar sits above the table, which follows the filters. */
        <div className="absolute inset-0 z-[15] flex flex-col bg-map-bg">
          <div className="relative z-10 flex flex-col gap-2 px-3 pt-3 lg:px-3.5 lg:pt-3.5">
            <StatusBarRow desktop={desktop} />
            <ActiveFilterChips />
          </div>
          <div className="relative min-h-0 flex-1">
            <TableView onBack={() => setView('map')} onLocate={locate} />
          </div>
        </div>
      ) : desktop ? (
        <>
          <div className="pointer-events-none absolute inset-x-3.5 top-3.5 z-20">
            <StatusBarRow desktop />
          </div>
          <div className="pointer-events-none absolute top-[70px] left-3.5 z-10 flex max-w-[calc(100%-470px)] flex-col items-start gap-2.5">
            <ActiveFilterChips />
            <FleetPulseCard />
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2">
          <StatusBarRow desktop={false} />
          <ActiveFilterChips />
        </div>
      )}
      <MapToolbar onTable={() => setView('table')} />
      {desktop && !table && <VehicleTray />}
      {debug && <DebugOverlay />}
      <VehicleDetailsPanel />
      {!table && <HeadingCompass />}
      <MapNotice />
    </div>
  );
}
