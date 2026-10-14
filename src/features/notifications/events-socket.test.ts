import type { Me } from '@shared/contract/index.ts';
import { WS_CLOSE } from '@shared/contract/ws-protocol.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { SessionStore } from '@/features/auth/session/session-store';
import { fakeSockets } from '@/features/live-tracking/worker/testing/fake-socket';
import { EventsSocket, eventsScope } from './events-socket.ts';
import { note } from './testing/fake-notifications.ts';

function setup(session: SessionStore) {
  const s = fakeSockets();
  const socket = new EventsSocket({
    session,
    url: 'ws://test/ws/live',
    createSocket: s.create,
    random: () => 1,
    backoffBaseMs: 500,
    backoffMaxMs: 30_000,
  });
  return { ...s, socket };
}

const subscribed = { type: 'subscribed' as const, id: 'events' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('F15-T2: events-socket', () => {
  it('opens nothing until a handler is registered and the session is signed in', async () => {
    let resolve!: (me: Me) => void;
    const session = new SessionStore(
      fakeApi({ me: vi.fn(() => new Promise<Me>((r) => (resolve = r))) }),
    );
    const { sockets, socket, last } = setup(session);
    const load = session.load();
    socket.onEvent('notification', () => {});
    expect(sockets).toHaveLength(0);
    resolve(fakeMe());
    await load;
    expect(sockets).toHaveLength(1);
    last().open();
    expect(last().sent).toEqual([
      { type: 'subscribe', id: 'events', topic: 'events', scope: { kind: 'fleet', fleetIds: ['f1'] } },
    ]);
  });

  it('routes events by kind to their handlers and stops after unsubscribe', async () => {
    const { socket, last } = setup(await sessionAs('authenticated'));
    const notes = vi.fn();
    const assignments = vi.fn();
    const off = socket.onEvent('notification', notes);
    socket.onEvent('assignment', assignments);
    last().open();
    last().message({ type: 'event', id: 'events', kind: 'notification', data: note(1) });
    expect(notes).toHaveBeenCalledWith(note(1));
    expect(assignments).not.toHaveBeenCalled();
    off();
    last().message({ type: 'event', id: 'events', kind: 'notification', data: note(2) });
    expect(notes).toHaveBeenCalledTimes(1);
  });

  it('one socket for every handler; closes when the last one goes', async () => {
    const { sockets, socket, last } = setup(await sessionAs('authenticated'));
    const a = socket.onEvent('notification', () => {});
    const b = socket.onEvent('request', () => {});
    const c = socket.onSync(() => {});
    expect(sockets).toHaveLength(1);
    a();
    b();
    expect(last().closed).toBe(false);
    c();
    expect(last().closed).toBe(true);
  });

  it('reconnects with backoff, re-subscribes and reports reconnect to onSync', async () => {
    const { sockets, socket, last } = setup(await sessionAs('authenticated'));
    const sync = vi.fn();
    socket.onSync(sync);
    last().open();
    last().message(subscribed);
    expect(sync).toHaveBeenLastCalledWith({ reconnect: false });

    last().serverClose(1006);
    expect(socket.getState()).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent[0]).toMatchObject({ type: 'subscribe', topic: 'events' });
    last().message(subscribed);
    expect(sync).toHaveBeenLastCalledWith({ reconnect: true });

    // Backoff grows while the server stays away (500 ms → 1 s), and resets once subscribed.
    last().serverClose(1006);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
    last().serverClose(1006);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(4);
  });

  it('closes on sign-out and reopens with the new user after sign-in', async () => {
    const session = await sessionAs('authenticated');
    const { sockets, socket, last } = setup(session);
    socket.onEvent('notification', () => {});
    last().open();
    await session.logout();
    expect(last().closed).toBe(true);
    expect(socket.getState()).toBe('offline');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    await session.login('ops@fms.local', 'x');
    expect(sockets).toHaveLength(2);
  });

  it('a 4401 close expires the session', async () => {
    const session = await sessionAs('authenticated');
    const { socket, last } = setup(session);
    socket.onEvent('notification', () => {});
    last().open();
    last().serverClose(WS_CLOSE.unauthenticated);
    expect(session.getSnapshot()).toMatchObject({ status: 'anonymous', notice: 'expired' });
  });

  it('now() follows the server clock from heartbeats', async () => {
    vi.setSystemTime(1_000_000);
    const { socket, last } = setup(await sessionAs('authenticated'));
    socket.onEvent('notification', () => {});
    last().open();
    last().message({ type: 'heartbeat', ts: 1_000_000 + 86_400_000 });
    expect(socket.now()).toBe(1_000_000 + 86_400_000);
  });

  it('scope: staff → fleets, driver → self, nothing otherwise', () => {
    expect(eventsScope(fakeMe('u', 'S', ['live.view']))).toEqual({
      kind: 'fleet',
      fleetIds: ['f1'],
    });
    expect(eventsScope(fakeMe('u', 'D', ['driver.self']))).toEqual({ kind: 'self' });
    expect(eventsScope(fakeMe('u', 'A', ['users.manage']))).toBeNull();
    expect(eventsScope(null)).toBeNull();
  });
});
