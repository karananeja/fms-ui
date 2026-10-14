import { useSyncExternalStore } from 'react';

export interface ExternalStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
}

/** Subscribes to one field of a class store (select fields or stable references only). */
export function useStore<S, T>(store: ExternalStore<S>, selector: (state: S) => T): T {
  const get = () => selector(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * The virtualiser's items, or the first `max` rows at fixed offsets while its scroller has no
 * size yet (first paint, hidden containers, jsdom), so lists never render empty.
 */
export function windowOrFirst<T extends { index: number; start: number }>(
  items: readonly T[],
  count: number,
  rowHeight: number,
  max = 100,
): readonly { index: number; start: number }[] {
  if (items.length > 0 || count === 0) return items;
  return Array.from({ length: Math.min(count, max) }, (_, index) => ({
    index,
    start: index * rowHeight,
  }));
}
