import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { selectMe, useSession, useSessionStore } from '@/features/auth/session/use-session';
import {
  DashboardChatStore,
  type DashboardChatCallbacks,
  type DashboardChatDeps,
  type DashboardChatState,
} from './dashboard-chat-store.ts';

/** Tests inject a fake transport / API here; the app uses the defaults. */
export const DashboardChatDepsContext = createContext<DashboardChatDeps>({});

const LOADING: DashboardChatState = {
  status: 'loading',
  messages: [],
  streaming: false,
  notConfigured: false,
  error: null,
  notice: null,
  undoing: null,
};
const noSubscribe = () => () => {};

export interface UseDashboardChat {
  state: DashboardChatState;
  send(text: string): void;
  stop(): void;
  retry(): void;
  /** `version` defaults to the change's `afterVersion` (pass the page's current version). */
  undo(changeId: string, version?: number): Promise<void>;
  dismissNotice(): void;
  /** D-135: records a preview card's state on the server. */
  setPreviewStatus(previewId: string, status: 'added' | 'discarded'): Promise<void>;
}

/**
 * F19 §7: the chat docked on `/dashboards/$id`. One store per (dashboard, user), created on
 * mount and disposed on unmount or user change; the thread is loaded on creation.
 */
export function useDashboardChat(
  dashboardId: string,
  callbacks: DashboardChatCallbacks = {},
): UseDashboardChat {
  const deps = use(DashboardChatDepsContext);
  const session = useSessionStore();
  const userId = useSession(selectMe)?.user.id ?? null;
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });

  const [store, setStore] = useState<DashboardChatStore | null>(null);
  useEffect(() => {
    if (!userId) return;
    const s = new DashboardChatStore(
      dashboardId,
      {
        onDashboardChanged: (d, e) => latest.current.onDashboardChanged?.(d, e),
        onDashboardCreated: (summary, url) => latest.current.onDashboardCreated?.(summary, url),
      },
      { onUnauthorized: session.expire, ...deps },
    );
    setStore(s);
    void s.load();
    return () => {
      s.dispose();
      setStore((cur) => (cur === s ? null : cur));
    };
  }, [dashboardId, userId, deps, session]);

  const get = useCallback(() => store?.getSnapshot() ?? LOADING, [store]);
  const state = useSyncExternalStore(store?.subscribe ?? noSubscribe, get, get);

  return useMemo(
    () => ({
      state,
      send: (text: string) => store?.send(text),
      stop: () => store?.stop(),
      retry: () => store?.retry(),
      undo: (changeId: string, version?: number) =>
        store ? store.undo(changeId, version) : Promise.resolve(),
      dismissNotice: () => store?.dismissNotice(),
      setPreviewStatus: (previewId: string, status: 'added' | 'discarded') =>
        store ? store.setPreviewStatus(previewId, status) : Promise.resolve(),
    }),
    [state, store],
  );
}
