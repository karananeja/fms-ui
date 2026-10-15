import { useState } from 'react';
import { widgetPermission, type Widget } from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import { useLiveTracking } from '@/features/live-tracking/store/use-live-tracking';
import type { LiveTrackingState } from '@/features/live-tracking/store/live-tracking-store';
import type { LiveWidgetQuery, LiveWidgetResult } from '@/features/live-tracking/worker/worker-api';
import { issueOf, type WidgetIssue } from '../components/widget-states';
import { useWidgetData } from '../data/use-widget-data';
import { widgetRequest } from '../data/widget-queries';
import { useLiveWidget } from '../live/use-live-widget';

export interface WidgetData<T> {
  issue: WidgetIssue | null;
  data: T | undefined;
  /** First load (no data yet). */
  loading: boolean;
  /** A refresh is in flight over existing data. */
  refreshing: boolean;
  refresh(): void;
}

/** Does the viewer have the widget's permission (`text` needs none)? */
export function useWidgetAllowed(w: Widget): boolean {
  const p = widgetPermission(w);
  const allowed = useCan(p ?? []);
  return p === null || allowed;
}

/** §6.2 REST/analytics widgets: permission first (no fetch without it), then the page cache. */
export function useRestWidget<T>(w: Widget): WidgetData<T> {
  const allowed = useWidgetAllowed(w);
  const entry = useWidgetData(allowed ? widgetRequest(w) : null);
  const hasData = entry.data !== undefined;
  const issue: WidgetIssue | null = !allowed
    ? 'no-access'
    : entry.error && !hasData
      ? issueOf(entry.error)
      : null;
  return {
    issue,
    data: entry.data as T | undefined,
    loading: allowed && !hasData && !issue,
    refreshing: hasData && entry.loading,
    refresh: entry.refresh,
  };
}

const selectFleets = (s: LiveTrackingState) => s.fleets;

/**
 * §6.2 live widgets: no-access without `live.view`; "outside your fleets" when the widget names a
 * fleet the viewer can't see (once the permitted fleets are known); loading until the snapshot.
 */
export function useLiveWidgetData(
  w: Widget,
  query: LiveWidgetQuery,
  fleetIds: readonly string[],
  /** F26: off-screen — unregister the query and keep showing the last result. */
  paused = false,
): WidgetData<LiveWidgetResult> {
  const allowed = useWidgetAllowed(w);
  const fleets = useLiveTracking(selectFleets);
  const outside = fleets.length > 0 && fleetIds.some((id) => !fleets.some((f) => f.id === id));
  const state = useLiveWidget(allowed && !outside && !paused ? query : null);
  // The last result, kept while paused (state adjusted during render, React's documented pattern).
  const [last, setLast] = useState<LiveWidgetResult | null>(null);
  if (state.result && state.result !== last) setLast(state.result);
  const issue: WidgetIssue | null = !allowed
    ? 'no-access'
    : outside
      ? 'outside'
      : state.status === 'unavailable' && !paused
        ? 'no-access'
        : null;
  const result = paused ? last : state.result;
  return {
    issue,
    data: result ?? undefined,
    loading: !issue && !result,
    refreshing: false,
    refresh: () => {},
  };
}
