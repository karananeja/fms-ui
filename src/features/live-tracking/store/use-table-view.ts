import { useSyncExternalStore } from 'react';
import { tableViewStore, type TableViewState, type TableViewStore } from './table-view.ts';

/** Subscribes to a slice of the table state (select stable slices: fields, not new objects). */
export function useTableView<T>(
  selector: (state: TableViewState) => T,
  store: TableViewStore = tableViewStore,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
}
