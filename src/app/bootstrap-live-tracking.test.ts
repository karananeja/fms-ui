import { describe, expect, it, vi } from 'vitest';
import { SessionStore } from '@/features/auth/session/session-store';
import { fakeApi, fakeMe } from '@/features/auth/testing/fake-session';
import type { LiveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { bootstrapLiveTracking } from './bootstrap-live-tracking';

/** Just the store surface the bootstrap uses. */
function fakeLive() {
  let connection = 'offline';
  const listeners = new Set<() => void>();
  const live = {
    metrics: {},
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    getSnapshot: () => ({ connection }),
    closeWith: (state: string) => {
      connection = state;
      for (const l of listeners) l();
    },
  };
  return live;
}

describe('F02-R4: live tracking follows the session', () => {
  it('starts on sign-in, stops and clears caches on sign-out, restarts for another user', async () => {
    const api = fakeApi();
    const session = new SessionStore(api);
    const live = fakeLive();
    const resetCaches = vi.fn();
    bootstrapLiveTracking({ session, live: live as unknown as LiveTrackingStore, resetCaches });
    await session.load();
    expect(live.start).not.toHaveBeenCalled();

    await session.login('a', 'b');
    expect(live.start).toHaveBeenCalledWith(fakeMe());
    await session.logout();
    expect(live.stop).toHaveBeenCalledTimes(1);
    expect(resetCaches).toHaveBeenCalledTimes(1);

    vi.mocked(api.login).mockResolvedValueOnce(fakeMe('u-2', 'Other'));
    await session.login('c', 'd');
    expect(live.start).toHaveBeenLastCalledWith(fakeMe('u-2', 'Other'));
    // A different user signing in over an active session gets a fresh worker.
    await session.acceptInvite('t', 'New', 'abcd1234');
    expect(live.stop).toHaveBeenCalledTimes(2);
    expect(live.start).toHaveBeenCalledTimes(3);
  });

  it('a WS close with `unauthenticated` expires the session (and stops the worker)', async () => {
    const session = new SessionStore(fakeApi());
    const live = fakeLive();
    bootstrapLiveTracking({
      session,
      live: live as unknown as LiveTrackingStore,
      resetCaches: () => {},
    });
    await session.login('a', 'b');
    live.closeWith('unauthenticated');
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', notice: 'expired' });
    expect(live.stop).toHaveBeenCalledTimes(1);
  });
});
