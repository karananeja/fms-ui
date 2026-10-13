// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from './worker-api.ts';
import { backoffDelay, systemClock, WsClient } from './ws-client.ts';
import { fakeSockets } from './testing/fake-socket.ts';

const BASE = 500;
const MAX = 30_000;

function setup(random = () => 1) {
  const s = fakeSockets();
  const states: ConnectionState[] = [];
  const messages: unknown[] = [];
  const client = new WsClient({
    url: 'ws://test/ws/live',
    createSocket: s.create,
    clock: systemClock,
    random,
    backoffBaseMs: BASE,
    backoffMaxMs: MAX,
    heartbeatTimeoutMs: 30_000,
    onOpen: () => {},
    onMessage: (m) => messages.push(m),
    onState: (st) => states.push(st),
  });
  client.connect();
  return { ...s, client, states, messages };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('F04-T1: ws-client', () => {
  it('backoff stays within [0, min(30 s, 500 ms × 2^attempt)] and is capped', () => {
    for (let a = 0; a < 20; a++) {
      const cap = Math.min(MAX, BASE * 2 ** a);
      for (const r of [0, 0.25, 0.5, 0.999]) {
        const d = backoffDelay(a, BASE, MAX, r);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(cap);
      }
      expect(backoffDelay(a, BASE, MAX, 1)).toBe(cap);
    }
    expect(backoffDelay(6, BASE, MAX, 1)).toBe(MAX);
    expect(backoffDelay(40, BASE, MAX, 1)).toBe(MAX);
  });

  it('reconnects with growing delays, and resetBackoff starts again from 500 ms', () => {
    const { sockets, last, client } = setup();
    last().open();
    expect(client.state).toBe('live');
    const closeAndWait = (expected: number) => {
      const n = sockets.length;
      last().serverClose(1006);
      expect(client.state).toBe('reconnecting');
      vi.advanceTimersByTime(expected - 1);
      expect(sockets.length).toBe(n);
      vi.advanceTimersByTime(1);
      expect(sockets.length).toBe(n + 1);
      last().open();
    };
    closeAndWait(500);
    closeAndWait(1000);
    closeAndWait(2000);
    client.resetBackoff();
    closeAndWait(500);
    expect(client.reconnects).toBe(4);
  });

  it.each([
    [4401, 'unauthenticated'],
    [4403, 'error'],
  ] as const)('close %i → %s with no reconnect', (code, state) => {
    const { sockets, last, client } = setup();
    last().open();
    last().serverClose(code);
    expect(client.state).toBe(state);
    vi.advanceTimersByTime(120_000);
    expect(sockets.length).toBe(1);
  });

  it('the watchdog closes and reconnects after 30 s of silence', () => {
    const { sockets, last, client } = setup();
    last().open();
    vi.advanceTimersByTime(29_999);
    last().message({ type: 'pong' });
    vi.advanceTimersByTime(29_999);
    expect(sockets[0]!.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sockets[0]!.closed).toBe(true);
    expect(client.state).toBe('reconnecting');
    vi.advanceTimersByTime(BASE);
    expect(sockets.length).toBe(2);
  });

  it('heartbeats update the server clock offset and now()', () => {
    vi.setSystemTime(1_000_000);
    const { last, client, messages } = setup();
    last().open();
    last().message({ type: 'heartbeat', ts: 1_060_000 });
    expect(client.serverOffsetMs).toBe(60_000);
    expect(client.now()).toBe(1_060_000);
    vi.advanceTimersByTime(5000);
    expect(client.now()).toBe(1_065_000);
    expect(messages).toHaveLength(1);
  });

  it('dispose closes the socket and never reconnects', () => {
    const { sockets, last, client } = setup();
    last().open();
    client.dispose();
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(sockets.length).toBe(1);
    expect(client.state).toBe('offline');
  });
});
