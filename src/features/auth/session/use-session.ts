import { createContext, use, useSyncExternalStore } from 'react';
import { sessionStore, type SessionState, type SessionStore } from './session-store.ts';

/** The app uses the singleton; tests provide their own store. */
export const SessionContext = createContext<SessionStore>(sessionStore);

export const useSessionStore = (): SessionStore => use(SessionContext);

/** Subscribes to one slice of the session (a primitive or a stable reference). */
export function useSession<T>(selector: (state: SessionState) => T): T {
  const store = useSessionStore();
  const get = () => selector(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}

export const selectStatus = (s: SessionState) => s.status;
export const selectMe = (s: SessionState) => s.me;
export const selectNotice = (s: SessionState) => s.notice;
