import type { DriverRequest, Fleet, RequestStatus, RequestType } from '@shared/contract/index.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeMe } from '@/features/auth/testing/fake-session';
import type { EventHandler, SyncHandler } from '@/features/notifications/events-socket';
import type { SessionState } from '@/features/auth/session/session-store';
import { RequestDeskStore } from './request-desk-store';
import type { RequestListQuery, RequestPage } from './api/requests-api';
import { availableActions, validateDispatch } from './lib/request-model';
import { notificationLink } from '@/features/notifications/notification-links';

const T0 = 1_760_000_000_000;

const req = (
  n: number,
  type: RequestType = 'breakdown',
  status: RequestStatus = 'open',
  over: Partial<DriverRequest> = {},
): DriverRequest => ({
  id: `req-${n}`,
  type,
  vehicleId: `v${n}`,
  driverId: `d${n}`,
  fleetId: 'f-north',
  status,
  ...(type === 'breakdown' ? { reason: 'tyre' as const } : {}),
  note: '',
  location: { lat: 28.6, lng: 77.2 },
  createdAt: T0 + n * 1000,
  updatedAt: T0 + n * 1000,
  timeline: [{ at: T0 + n * 1000, status: 'open', by: `u-d${n}` }],
  ...over,
});

const fleets: Fleet[] = [
  { id: 'f-root', parentId: null, name: 'Root', depth: 1, vehicleCount: 10 },
  { id: 'f-north', parentId: 'f-root', name: 'North', depth: 2, vehicleCount: 5 },
  { id: 'f-south', parentId: 'f-root', name: 'South', depth: 2, vehicleCount: 5 },
];

function setup(pages: RequestPage[], perms = ['requests.manage'] as const) {
  const requestHandlers = new Set<EventHandler<'request'>>();
  const syncs = new Set<SyncHandler>();
  const session: SessionState = {
    status: 'authenticated',
    me: fakeMe('u-1', 'Ops', [...perms]),
  } as SessionState;
  const list = vi.fn(async (q: RequestListQuery) => pages[q.cursor ? Number(q.cursor) : 0]!);
  const store = new RequestDeskStore({
    session: { getSnapshot: () => session, subscribe: () => () => {}, expire: () => {} },
    socket: {
      onEvent: ((_k: 'request', h: EventHandler<'request'>) => {
        requestHandlers.add(h);
        return () => requestHandlers.delete(h);
      }) as never,
      onSync: (h: SyncHandler) => {
        syncs.add(h);
        return () => syncs.delete(h);
      },
    },
    list,
    highlightMs: 1000,
  });
  return {
    store,
    list,
    emit: (r: DriverRequest) => requestHandlers.forEach((h) => h(r)),
    sync: (reconnect: boolean) => syncs.forEach((h) => h({ reconnect })),
    listeners: () => requestHandlers.size + syncs.size,
  };
}

const ids = (rs: readonly DriverRequest[]) => rs.map((r) => r.id);
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe('F14-T1: request desk store', () => {
  it('loads every page, newest first; open states by default; open count', async () => {
    const { store, list } = setup([
      { items: [req(4), req(3, 'rsa', 'resolved')], nextCursor: '1' },
      {
        items: [req(2, 'replacement', 'suggested'), req(1, 'rsa', 'dispatched')],
        nextCursor: null,
      },
    ]);
    const release = store.retain();
    await settle();
    expect(list).toHaveBeenCalledTimes(2);
    const s = store.getSnapshot();
    expect(s.status).toBe('ready');
    expect(ids(s.items)).toEqual(['req-4', 'req-3', 'req-2', 'req-1']);
    expect(ids(s.rows)).toEqual(['req-4', 'req-2', 'req-1']);
    expect(s.openCount).toBe(3);
    release();
  });

  it('filters by type, status, fleet subtree and reg no / driver label', async () => {
    const { store } = setup([
      {
        items: [
          req(3, 'rsa', 'acknowledged', { fleetId: 'f-south' }),
          req(2, 'replacement', 'waiting'),
          req(1, 'breakdown', 'closed'),
        ],
        nextCursor: null,
      },
    ]);
    store.retain();
    await settle();
    store.setFleets(fleets);
    store.setFilter({ type: 'rsa' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-3']);
    store.setFilter({ type: 'all', status: 'all' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-3', 'req-2', 'req-1']);
    store.setFilter({ status: 'closed' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-1']);
    store.setFilter({ status: 'all', fleetId: 'f-north' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-2', 'req-1']);
    store.setFilter({ fleetId: 'f-root' });
    expect(ids(store.getSnapshot().rows)).toHaveLength(3);
    store.setLabel('v2', 'MH12AB0002');
    store.setLabel('d3', 'Ravi Kumar');
    store.setFilter({ q: 'ab0002' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-2']);
    store.setFilter({ q: 'ravi' });
    expect(ids(store.getSnapshot().rows)).toEqual(['req-3']);
  });

  it('live merge: inserts, updates, and drops a row leaving the filtered set; highlights briefly', async () => {
    const { store, emit } = setup([{ items: [req(1)], nextCursor: null }]);
    store.retain();
    await settle();
    vi.useFakeTimers();
    emit(req(2, 'rsa'));
    let s = store.getSnapshot();
    expect(ids(s.rows)).toEqual(['req-2', 'req-1']);
    expect(s.openCount).toBe(2);
    expect(s.highlighted.has('req-2')).toBe(true);

    emit(req(1, 'breakdown', 'acknowledged', { updatedAt: T0 + 5000 }));
    s = store.getSnapshot();
    expect(s.items.find((r) => r.id === 'req-1')!.status).toBe('acknowledged');
    expect(ids(s.rows)).toEqual(['req-2', 'req-1']);

    emit(req(1, 'breakdown', 'resolved', { updatedAt: T0 + 9000 }));
    s = store.getSnapshot();
    expect(ids(s.rows)).toEqual(['req-2']);
    expect(s.openCount).toBe(1);
    // An older copy never overwrites a newer one.
    emit(req(1, 'breakdown', 'acknowledged', { updatedAt: T0 + 6000 }));
    expect(store.getSnapshot().items.find((r) => r.id === 'req-1')!.status).toBe('resolved');

    vi.advanceTimersByTime(1100);
    expect(store.getSnapshot().highlighted.size).toBe(0);
  });

  it('re-loads after a reconnect; stops listening on release; no desk without requests.manage', async () => {
    const t = setup([{ items: [req(1)], nextCursor: null }]);
    const release = t.store.retain();
    await settle();
    t.sync(false);
    expect(t.list).toHaveBeenCalledTimes(1);
    t.sync(true);
    await settle();
    expect(t.list).toHaveBeenCalledTimes(2);
    release();
    expect(t.listeners()).toBe(0);
    expect(t.store.getSnapshot().items).toEqual([]);

    const viewer = setup([{ items: [req(1)], nextCursor: null }], ['live.view'] as never);
    viewer.store.retain();
    await settle();
    expect(viewer.list).not.toHaveBeenCalled();
    expect(viewer.listeners()).toBe(0);
  });
});

describe('F14 state machine and helpers', () => {
  it('valid actions per type and state (F11 §2)', () => {
    expect(availableActions({ type: 'breakdown', status: 'open' })).toEqual(['acknowledge']);
    expect(availableActions({ type: 'breakdown', status: 'acknowledged' })).toEqual([
      'resolve',
      'close',
    ]);
    expect(availableActions({ type: 'rsa', status: 'acknowledged' })).toEqual(['dispatch']);
    expect(availableActions({ type: 'rsa', status: 'dispatched' })).toEqual(['resolve', 'close']);
    expect(availableActions({ type: 'replacement', status: 'suggested' })).toEqual([
      'approve',
      'override',
      'reject',
      'close',
    ]);
    expect(availableActions({ type: 'replacement', status: 'waiting' })).toEqual([
      'override',
      'reject',
      'close',
    ]);
    expect(availableActions({ type: 'replacement', status: 'assigned' })).toEqual([]);
  });

  it('dispatch validation', () => {
    expect(validateDispatch('', '')).toEqual({
      assignee: 'Enter who is going.',
      eta: 'Enter the ETA in minutes.',
    });
    expect(validateDispatch('Team A', '0').eta).toMatch(/1 to 1440/);
    expect(validateDispatch('Team A', '12.5').eta).toMatch(/whole number/);
    expect(validateDispatch('Team A', '1441').eta).toMatch(/1 to 1440/);
    expect(validateDispatch('Team A', '30')).toEqual({});
  });

  it('notification links: a request opens on the desk with requests.manage, else the vehicle', () => {
    const n = {
      id: 'n1',
      kind: 'request-created',
      severity: 'critical',
      title: 't',
      body: 'b',
      fleetId: 'f',
      vehicleId: 'v1',
      requestId: 'req-1',
      createdAt: T0,
      readAt: null,
    } as const;
    expect(notificationLink(n, { permissions: ['requests.manage', 'live.view'] })).toEqual({
      to: '/requests/$requestId',
      params: { requestId: 'req-1' },
    });
    expect(notificationLink(n, { permissions: ['live.view'] })).toEqual({
      to: '/live-tracking',
      search: { vehicle: 'v1' },
    });
    expect(notificationLink(n, { permissions: [] })).toBeNull();
  });
});
