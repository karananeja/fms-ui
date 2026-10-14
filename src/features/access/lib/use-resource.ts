import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True until the current request settles (data stays while reloading). */
  loading: boolean;
  /** Fetches again. */
  reload: () => void;
  /** Local update after a mutation (no refetch). */
  setData: (update: (prev: T | undefined) => T | undefined) => void;
}

/**
 * Loads `fetcher` on mount and whenever `key` changes; aborts the previous request. A tiny
 * stand-in for a query cache (no TanStack Query yet, D-076).
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key = '',
): Resource<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const request = `${key}#${tick}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetcherRef.current(ctrl.signal).then(
      (value) => {
        if (ctrl.signal.aborted) return;
        setDataState(value);
        setError(null);
        setSettled(request);
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err);
        setSettled(request);
      },
    );
    return () => ctrl.abort();
  }, [request]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (update: (prev: T | undefined) => T | undefined) => setDataState(update),
    [],
  );
  return { data, error, loading: settled !== request, reload, setData };
}
