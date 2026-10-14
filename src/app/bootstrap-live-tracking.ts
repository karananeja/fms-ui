import { can } from '@/features/access/permissions/can';
import { sessionStore, type SessionStore } from '@/features/auth/session/session-store';
import {
  liveTrackingStore,
  type LiveTrackingStore,
} from '@/features/live-tracking/store/live-tracking-store';
import { tableViewStore } from '@/features/live-tracking/store/table-view';

declare global {
  interface Window {
    __fmsLive?: typeof liveTrackingStore.metrics;
  }
}

interface Deps {
  session: SessionStore;
  live: LiveTrackingStore;
  /** Per-user REST caches to drop on sign-out (F02-R4). */
  resetCaches: () => void;
}

/**
 * F02-R4: live tracking follows the session. The worker starts when a user is authenticated,
 * stops on sign-out or expiry, and restarts for a different user. A WS close with
 * `unauthenticated` expires the session (F02-R3). Returns an unsubscribe for tests.
 * F03-R2: a user without `live.view` never starts the worker (no socket, no snapshot); caches
 * are still reset when that user changes.
 */
export function bootstrapLiveTracking(
  { session, live, resetCaches }: Deps = {
    session: sessionStore,
    live: liveTrackingStore,
    resetCaches: () => tableViewStore.reset(),
  },
): () => void {
  if (import.meta.env.DEV) window.__fmsLive = live.metrics;
  let userId: string | null = null;
  let running = false;

  const followSession = () => {
    const { me } = session.getSnapshot();
    const next = me?.user.id ?? null;
    if (next === userId) return;
    if (userId) {
      if (running) live.stop();
      resetCaches();
    }
    userId = next;
    running = !!me && can(me, 'live.view');
    if (running) live.start(me!);
  };
  const followSocket = () => {
    if (live.getSnapshot().connection === 'unauthenticated') session.expire();
  };

  const offSession = session.subscribe(followSession);
  const offLive = live.subscribe(followSocket);
  followSession();
  return () => {
    offSession();
    offLive();
  };
}
