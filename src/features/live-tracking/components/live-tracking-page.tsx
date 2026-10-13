import { useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
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
import { DESKTOP_QUERY, VehicleDetailsPanel } from './vehicle-details-panel';

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

/**
 * `/live-tracking`: full-bleed live map with its toolbar (F06), the details panel (F07) and the
 * status bar: search, filters, status pills, active chips and fleet pulse (F08).
 */
export function LiveTrackingPage() {
  useSelectionUrlSync();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const debug = useSearch({
    strict: false,
    select: (s) => String((s as { debug?: unknown }).debug) === '1',
  });
  return (
    <div className="live-tracking relative h-full overflow-hidden">
      <h1 className="sr-only">Live tracking</h1>
      <LiveMap />
      <div className="fms-vignette pointer-events-none absolute inset-0" aria-hidden />
      {/* DS1-R3 slots, filled by F08: desktop = one row; mobile = search row, then pills. */}
      {desktop ? (
        <>
          <div className="pointer-events-none absolute inset-x-3.5 top-3.5 z-20 flex items-center gap-2.5">
            <SearchBox />
            <FilterPanel />
            <StatusPills />
            <LivePill />
          </div>
          <div className="pointer-events-none absolute top-[70px] left-3.5 z-10 flex max-w-[calc(100%-470px)] flex-col items-start gap-2.5">
            <ActiveFilterChips />
            <FleetPulseCard />
          </div>
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SearchBox />
            <FilterPanel />
            <LivePill />
          </div>
          <StatusPills />
          <ActiveFilterChips />
        </div>
      )}
      <MapToolbar />
      {debug && <DebugOverlay />}
      <VehicleDetailsPanel />
      <HeadingCompass />
      <MapNotice />
    </div>
  );
}
