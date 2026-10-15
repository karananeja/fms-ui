import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSockets } from '@/features/live-tracking/worker/testing/fake-socket';
import { DashboardSocket } from './dashboard-socket.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const changed = (dashboardId: string, version: number) => ({
  type: 'dashboard' as const,
  id: `dash:${dashboardId}`,
  event: {
    kind: 'changed' as const,
    dashboardId,
    version,
    by: { userId: 'u-ops', name: 'Ops User' },
    at: 1,
    summary: 'Rearranged widgets',
  },
});

describe('F27 dashboard-socket', () => {
  it('one socket while watched; routes by dashboard; sync after a reconnect; closes when idle', () => {
    const s = fakeSockets();
    const socket = new DashboardSocket({
      url: 'ws://t/ws/live',
      createSocket: s.create,
      random: () => 0,
    });
    const a = vi.fn();
    const b = vi.fn();
    const offA = socket.watch('d1', a);
    expect(s.sockets).toHaveLength(1);
    s.last().open();
    const offB = socket.watch('d2', b);
    expect(s.sockets).toHaveLength(1);
    expect(s.last().sent.map((m) => m.type === 'subscribe' && m.scope)).toEqual([
      { kind: 'dashboard', dashboardId: 'd1' },
      { kind: 'dashboard', dashboardId: 'd2' },
    ]);
    s.last().message({ type: 'subscribed', id: 'dash:d1' });
    s.last().message(changed('d1', 3));
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ kind: 'changed', version: 3 }));
    expect(b).not.toHaveBeenCalled();

    // Reconnect: re-subscribes, then `sync` so the page re-reads what it missed.
    s.last().serverClose(1006);
    vi.advanceTimersByTime(10);
    expect(s.sockets).toHaveLength(2);
    s.last().open();
    s.last().message({ type: 'subscribed', id: 'dash:d1' });
    expect(a).toHaveBeenLastCalledWith({ kind: 'sync', dashboardId: 'd1' });

    offA();
    expect(s.last().sent.at(-1)).toEqual({ type: 'unsubscribe', id: 'dash:d1' });
    offB();
    expect(s.last().closed).toBe(true);
  });
});
