import { useMemo, useSyncExternalStore } from 'react';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from './live-tracking-store.ts';

/** `getSnapshot` for a slice: stable while the state or the selected value is unchanged. */
function memoSelector<T>(
  store: LiveTrackingStore,
  selector: (state: LiveTrackingState) => T,
  isEqual: (a: T, b: T) => boolean,
) {
  let last: { state: LiveTrackingState; value: T } | undefined;
  return () => {
    const state = store.getSnapshot();
    if (last?.state === state) return last.value;
    const value = selector(state);
    last = { state, value: last && isEqual(last.value, value) ? last.value : value };
    return last.value;
  };
}

/** Subscribes to a slice of the live-tracking state; re-renders only when the slice changes. */
export function useLiveTracking<T>(
  selector: (state: LiveTrackingState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  store: LiveTrackingStore = liveTrackingStore,
): T {
  const getSelection = useMemo(
    () => memoSelector(store, selector, isEqual),
    [store, selector, isEqual],
  );
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
