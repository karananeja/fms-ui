import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { LiveTrackingSearch } from './use-selection-url-sync';

export type LiveView = 'map' | 'table';

const viewOf = (search: unknown): LiveView =>
  (search as LiveTrackingSearch).view === 'table' ? 'table' : 'map';

/** F09-R1: the current view from `?view=` and a setter that keeps the other params. */
export function useLiveView(): [LiveView, (view: LiveView) => void] {
  const view = useSearch({ strict: false, select: viewOf });
  const navigate = useNavigate();
  const setView = useCallback(
    (next: LiveView) =>
      void navigate({
        to: '/live-tracking',
        search: (prev: LiveTrackingSearch) => ({
          ...prev,
          view: next === 'table' ? ('table' as const) : undefined,
        }),
      }),
    [navigate],
  );
  return [view, setView];
}
