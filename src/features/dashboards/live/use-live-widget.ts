import { createContext, use, useCallback, useSyncExternalStore } from 'react';
import type { LiveWidgetQuery } from '@/features/live-tracking/worker/worker-api';
import { liveQueryKey, type LiveWidgetSource, type LiveWidgetState } from './live-widget-source';

export const LiveWidgetSourceContext = createContext<LiveWidgetSource | null>(null);

const NONE: LiveWidgetState = { status: 'unavailable', result: null };
const noop = () => () => {};

/** A live widget's worker result; `query` null = nothing to ask (no access, outside fleets). */
export function useLiveWidget(query: LiveWidgetQuery | null): LiveWidgetState {
  const source = use(LiveWidgetSourceContext);
  const key = query ? liveQueryKey(query) : null;
  const subscribe = useCallback(
    (listener: () => void) => (source && query ? source.register(query, listener) : noop()),
    // The query object is rebuilt every render; its key identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, key],
  );
  const get = useCallback(() => (source && key ? source.get(key) : NONE), [source, key]);
  return useSyncExternalStore(subscribe, get, get);
}
