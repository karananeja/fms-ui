import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';

export interface LiveTrackingSearch {
  vehicle?: string;
  debug?: string;
  /** F09-R1: `table` shows the table view; absent = map. */
  view?: 'table';
}

/** `validateSearch` for `/live-tracking`: ids stay strings even when they look numeric. */
export function parseLiveTrackingSearch(search: Record<string, unknown>): LiveTrackingSearch {
  const { vehicle, debug, view } = search;
  return {
    ...(vehicle != null && vehicle !== '' && { vehicle: String(vehicle) }),
    ...(debug != null && { debug: String(debug) }),
    ...(view === 'table' && { view: 'table' as const }),
  };
}

const selectReady = (s: LiveTrackingState) => s.stats.snapshotComplete;
const vehicleOf = (search: unknown) => (search as LiveTrackingSearch).vehicle ?? null;

/**
 * F07-R1: `?vehicle=` ⇄ `store.selectedVehicleId`. URL → store waits for the first complete
 * snapshot (the worker only selects vehicles it knows, D-033); store → URL reacts only to changes
 * of the selection, and each side is a no-op when both already agree, so there is no loop.
 */
export function useSelectionUrlSync(store = liveTrackingStore): void {
  const router = useRouter();
  const navigate = useNavigate();
  const vehicle = useSearch({ strict: false, select: vehicleOf });
  const ready = useLiveTracking(selectReady, Object.is, store);

  useEffect(() => {
    if (ready && vehicle !== store.getSnapshot().selectedVehicleId)
      void store.selectVehicle(vehicle);
  }, [ready, vehicle, store]);

  useEffect(() => {
    let last = store.getSnapshot().selectedVehicleId;
    return store.subscribe(() => {
      const id = store.getSnapshot().selectedVehicleId;
      if (id === last) return;
      last = id;
      if (id === vehicleOf(router.state.location.search)) return;
      void navigate({
        to: '/live-tracking',
        search: (prev: LiveTrackingSearch) => ({ ...prev, vehicle: id ?? undefined }),
      });
    });
  }, [store, router, navigate]);
}
