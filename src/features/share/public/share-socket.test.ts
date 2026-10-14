import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareSocket, shareSocketUrl } from './share-socket';
import { combinfo, fakeShareSockets } from './testing/fake-share-socket';

function setup() {
  const fake = fakeShareSockets();
  const socket = new ShareSocket({
    token: 'tok en',
    vehicleId: 'v_in_1',
    createSocket: fake.create,
    random: () => 1,
    backoffBaseMs: 1000,
    backoffMaxMs: 8000,
  });
  socket.start();
  fake.last().open();
  fake.last().push({ type: 'subscribed', id: 'share' });
  return { ...fake, socket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('F10-T4: share-socket', () => {
  it('opens /ws/live?share=<token> and subscribes to combinfo for the vehicle only', () => {
    const { sockets, socket } = setup();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe(`ws://${location.host}/ws/live?share=tok%20en`);
    expect(sockets[0]!.sent).toEqual([
      {
        type: 'subscribe',
        id: 'share',
        topic: 'combinfo',
        scope: { kind: 'vehicle', vehicleId: 'v_in_1' },
      },
    ]);
    expect(socket.getSnapshot().connection).toBe('live');
    expect(shareSocketUrl('t', { protocol: 'https:', host: 'x.io' })).toBe(
      'wss://x.io/ws/live?share=t',
    );
  });

  it('latest wins: an older gpstime is ignored', () => {
    const { last, socket } = setup();
    last().push({ type: 'payload', id: 'share', topic: 'combinfo', data: combinfo(2000) });
    expect(socket.getSnapshot().latest?.gpstime).toBe(2000);
    last().push({ type: 'payload', id: 'share', topic: 'combinfo', data: combinfo(1000) });
    expect(socket.getSnapshot().latest?.gpstime).toBe(2000);
    last().push({ type: 'payload', id: 'share', topic: 'combinfo', data: combinfo(3000) });
    expect(socket.getSnapshot().latest?.gpstime).toBe(3000);
  });

  it('heartbeats give the server clock offset', () => {
    const { last, socket } = setup();
    last().push({ type: 'heartbeat', ts: Date.now() + 5000 });
    expect(socket.getSnapshot().serverOffsetMs).toBe(5000);
  });

  it.each([
    [4410, 'gone'],
    [4401, 'not-found'],
    [4403, 'error'],
  ] as const)('close %i → %s, never reconnects', (code, state) => {
    const { sockets, last, socket } = setup();
    last().serverClose(code);
    expect(socket.getSnapshot().connection).toBe(state);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
  });

  it('a network close reconnects with backoff and subscribes again; latest is kept', () => {
    const { sockets, last, socket } = setup();
    last().push({ type: 'payload', id: 'share', topic: 'combinfo', data: combinfo(2000) });
    last().serverClose(1006);
    expect(socket.getSnapshot().connection).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent).toHaveLength(1);
    // Second failure in a row: the delay doubles.
    last().serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    expect(socket.getSnapshot().latest?.gpstime).toBe(2000);
  });

  it('silence (no heartbeat) drops the socket and reconnects; dispose stops everything', () => {
    const { sockets, socket } = setup();
    vi.advanceTimersByTime(40_000);
    expect(sockets[0]!.closed).toBe(true);
    expect(socket.getSnapshot().connection).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    socket.dispose();
    expect(sockets[1]!.closed).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(2);
  });
});
