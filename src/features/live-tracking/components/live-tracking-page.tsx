import { useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import { useSelectionUrlSync } from '../hooks/use-selection-url-sync';
import { DebugOverlay } from './debug-overlay';
import { HeadingCompass } from './heading-compass';
import { LiveMap } from './live-map';
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
      className="pointer-events-none absolute inset-x-0 bottom-12 z-20 flex justify-center"
    >
      {notice && (
        <p className="rounded-md border bg-surface-1 px-4 py-2 text-sm shadow-lg">
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
      <MapToolbar />
      {debug && <DebugOverlay />}
      <VehicleDetailsPanel />
      <HeadingCompass />
      <MapNotice />
    </div>
  );
}
