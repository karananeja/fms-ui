import { createContext, use, useCallback, useEffect, useSyncExternalStore } from 'react';
import { QueryCache, REFRESH_MS, type CacheEntry } from './query-cache';
import type { WidgetRequest } from './widget-queries';

export const QueryCacheContext = createContext<QueryCache | null>(null);

const IDLE: CacheEntry = { data: undefined, error: null, loading: false, fetchedAt: 0 };
const noop = () => () => {};

/** A REST widget's data from the page cache; `req` null = nothing to fetch (e.g. no access). */
export function useWidgetData(req: WidgetRequest | null): CacheEntry & { refresh(): void } {
  const cache = use(QueryCacheContext);
  const key = req?.key ?? null;
  const subscribe = useCallback(
    (listener: () => void) => (cache && req ? cache.subscribe(req, listener) : noop()),
    // `req` is rebuilt every render; its key identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cache, key],
  );
  const get = useCallback(() => (cache && key ? cache.get(key) : IDLE), [cache, key]);
  const entry = useSyncExternalStore(subscribe, get, get);
  const refresh = useCallback(() => {
    if (key) cache?.refresh(key);
  }, [cache, key]);
  return { ...entry, refresh };
}

/**
 * D-131: one page timer refreshes every REST widget each `REFRESH_MS` while the tab is visible;
 * returning to a hidden tab refreshes what went stale.
 */
export function useAutoRefresh(cache: QueryCache, intervalMs = REFRESH_MS): void {
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) cache.refresh();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) cache.refreshStale(intervalMs);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cache, intervalMs]);
}
