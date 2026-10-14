import { createContext, use, useSyncExternalStore } from 'react';
import { requestDeskStore, type DeskState, type RequestDeskStore } from './request-desk-store';

/** The app uses the singleton; component tests provide their own store. */
export const RequestDeskContext = createContext<RequestDeskStore>(requestDeskStore);

/** One slice of the desk state (a primitive or a stable reference) and the store. */
export function useRequestDesk<T>(selector: (s: DeskState) => T): {
  store: RequestDeskStore;
  state: T;
} {
  const store = use(RequestDeskContext);
  const get = () => selector(store.getSnapshot());
  const state = useSyncExternalStore(store.subscribe, get, get);
  return { store, state };
}
