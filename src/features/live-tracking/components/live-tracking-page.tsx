import { useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { useSelectionUrlSync } from '../hooks/use-selection-url-sync';
import { DebugOverlay } from './debug-overlay';
import { HeadingCompass } from './heading-compass';
import { LiveMap } from './live-map';
import { LivePill } from './live-pill';
import { MapToolbar } from './map-toolbar';
import { VehicleDetailsPanel } from './vehicle-details-panel';

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

/** `/live-tracking`: full-bleed live map with its toolbar (F06) and the details panel (F07). */
export function LiveTrackingPage() {
  useSelectionUrlSync();
  const debug = useSearch({
    strict: false,
    select: (s) => String((s as { debug?: unknown }).debug) === '1',
  });
  return (
    <div className="live-tracking relative h-full overflow-hidden">
      <h1 className="sr-only">Live tracking</h1>
      <LiveMap />
      <div className="fms-vignette pointer-events-none absolute inset-0" aria-hidden />
      {/* DS1-R3: top overlay slots (search left, status chips right) for F08; hidden while empty. */}
      <div className="pointer-events-none absolute inset-x-3.5 top-3.5 z-10 flex items-center gap-2.5">
        <div data-slot="map-search" className="pointer-events-auto empty:hidden" />
        <div data-slot="map-status-chips" className="pointer-events-auto empty:hidden" />
        <LivePill />
      </div>
      <MapToolbar />
      {debug && <DebugOverlay />}
      <VehicleDetailsPanel />
      <HeadingCompass />
      <MapNotice />
    </div>
  );
}
