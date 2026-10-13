import type { Me } from '@shared/contract/index.ts';
import { act, renderHook } from '@testing-library/react';
import { releaseProxy, type Remote } from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import type { LivePush, LiveTrackingWorkerApi } from '../worker/worker-api.ts';
import { LiveTrackingStore, type LiveTrackingState } from './live-tracking-store.ts';
import { useLiveTracking } from './use-live-tracking.ts';

const me = { fleetIds: ['f0'] } as unknown as Me;

function fakeWorker() {
  let onPush: ((p: LivePush) => void) | undefined;
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn(async (id: string | null) => id !== 'missing'),
    getVehicleSummary: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
    [releaseProxy]: vi.fn(),
  };
  const createWorkerApi = vi.fn(() => api as unknown as Remote<LiveTrackingWorkerApi>);
  const store = new LiveTrackingStore({ createWorkerApi });
  const push = (over: Partial<LivePush> = {}, stats: Partial<LivePush['stats']> = {}) =>
    onPush!({
      connection: 'live',
      version: 1,
      ...over,
      stats: { ...store.getSnapshot().stats, vehicleCount: 10, ...stats },
    });
  return { api, createWorkerApi, store, push };
}

describe('F04-T7: LiveTrackingStore', () => {
  it('start is idempotent and wires the worker', () => {
    const { store, createWorkerApi, api } = fakeWorker();
    store.start(me);
    store.start(me);
    expect(createWorkerApi).toHaveBeenCalledTimes(1);
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.init.mock.calls[0]![0]).toBe(me);
  });

  it('getSnapshot is stable until a push changes it', () => {
    const { store, push } = fakeWorker();
    const initial = store.getSnapshot();
    expect(initial.connection).toBe('offline');
    store.start(me);
    expect(store.getSnapshot()).toBe(initial);
    push();
    const next = store.getSnapshot();
    expect(next).not.toBe(initial);
    expect(next).toMatchObject({ connection: 'live', stats: { vehicleCount: 10 } });
    expect(store.getSnapshot()).toBe(next);
  });

  it('notifies listeners and stops after unsubscribe', () => {
    const { store, push } = fakeWorker();
    store.start(me);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    push();
    push();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    push();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tracks selection and only accepts payloads for the selected vehicle', async () => {
    const { store, push, api } = fakeWorker();
    store.start(me);
    await store.selectVehicle('v1');
    expect(api.selectVehicle).toHaveBeenCalledWith('v1');
    expect(store.getSnapshot()).toMatchObject({ selectedVehicleId: 'v1', selected: null });
    const selected = { vehicleId: 'v1', found: true, combinfo: null, lafparsed: null };
    push({ selected });
    expect(store.getSnapshot().selected).toBe(selected);
    push({ selected: { ...selected, vehicleId: 'v2' } });
    expect(store.getSnapshot().selected).toBe(selected);
    push();
    expect(store.getSnapshot().selected).toBe(selected);
    await store.selectVehicle('missing');
    expect(store.getSnapshot().selected).toMatchObject({ vehicleId: 'missing', found: false });
    await store.selectVehicle(null);
    expect(store.getSnapshot()).toMatchObject({ selectedVehicleId: null, selected: null });
  });

  it('records e2e metrics', () => {
    const { store, push } = fakeWorker();
    store.start(me);
    push({}, { vehicleCount: 0 });
    expect(store.metrics.firstDataAt).toBe(0);
    push({}, { snapshotComplete: true });
    expect(store.metrics).toMatchObject({ pushCount: 2 });
    expect(store.metrics.firstDataAt).toBeGreaterThan(0);
    expect(store.metrics.snapshotCompleteAt).toBeGreaterThan(0);
  });

  it('stop disposes the worker and resets; start creates a new one', () => {
    const { store, push, api, createWorkerApi } = fakeWorker();
    store.start(me);
    push();
    store.stop();
    expect(api.dispose).toHaveBeenCalledTimes(1);
    expect(api[releaseProxy]).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().connection).toBe('offline');
    store.start(me);
    expect(createWorkerApi).toHaveBeenCalledTimes(2);
  });
});

describe('F04-R21: useLiveTracking', () => {
  it('re-renders only when the selected slice changes', () => {
    const { store, push } = fakeWorker();
    store.start(me);
    let renders = 0;
    const select = (s: LiveTrackingState) => s.connection;
    const { result } = renderHook(() => {
      renders++;
      return useLiveTracking(select, Object.is, store);
    });
    expect(result.current).toBe('offline');
    act(() => push());
    expect(result.current).toBe('live');
    const n = renders;
    act(() => {
      push({}, { vehicleCount: 11 });
      push({}, { vehicleCount: 12 });
    });
    expect(renders).toBe(n);
  });
});
