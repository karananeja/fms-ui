import { createContext, use, useSyncExternalStore } from 'react';
import { assistantStore, type AssistantState, type AssistantStore } from './assistant-store.ts';

/** The app uses the singleton; component tests provide their own store. */
export const AssistantStoreContext = createContext<AssistantStore>(assistantStore);

export const useAssistantStore = (): AssistantStore => use(AssistantStoreContext);

/** Subscribes to one slice of the conversation (a primitive or a stable reference). */
export function useAssistant<T>(selector: (s: AssistantState) => T): T {
  const store = useAssistantStore();
  const get = () => selector(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}
