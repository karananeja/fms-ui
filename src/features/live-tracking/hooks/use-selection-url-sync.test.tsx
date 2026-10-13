import type { Me } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { releaseProxy, type Remote } from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import { LiveTrackingStore } from '../store/live-tracking-store';
import type { LivePush, LiveTrackingWorkerApi } from '../worker/worker-api';
import { parseLiveTrackingSearch, useSelectionUrlSync } from './use-selection-url-sync';

const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as LivePush['statusCounts'];

function setup(path: string) {
  let onPush: (p: LivePush) => void = () => {};
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn<(id: string | null) => Promise<boolean>>(async () => true),
    getVehicleSummary: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
    [releaseProxy]: vi.fn(),
  };
  const store = new LiveTrackingStore({
    createWorkerApi: () => api as unknown as Remote<LiveTrackingWorkerApi>,
  });
  store.start({ fleetIds: ['f0'], permissions: [] } as unknown as Me);
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: 'live-tracking',
    validateSearch: parseLiveTrackingSearch,
    component: function Page() {
      useSelectionUrlSync(store);
      return null;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  const ready = () =>
    act(() =>
      onPush({
        connection: 'live',
        stats: { ...store.getSnapshot().stats, snapshotComplete: true },
        version: 1,
        statusCounts: counts,
        total: 1,
      }),
    );
  const vehicle = () => (router.state.location.search as { vehicle?: string }).vehicle;
  return { api, store, router, ready, vehicle };
}

describe('F07-R1: ?vehicle= ⇄ store selection', () => {
  it('parses ids as strings', () => {
    expect(parseLiveTrackingSearch({ vehicle: 123, debug: 1 })).toEqual({
      vehicle: '123',
      debug: '1',
    });
    expect(parseLiveTrackingSearch({ vehicle: '' })).toEqual({});
  });

  it('deep link selects after the snapshot; store changes push history; back restores', async () => {
    const { api, store, router, ready, vehicle } = setup('/live-tracking?vehicle=v1&debug=1');
    await waitFor(() => expect(router.state.status).toBe('idle'));
    expect(api.selectVehicle).not.toHaveBeenCalled();
    ready();
    await waitFor(() => expect(store.getSnapshot().selectedVehicleId).toBe('v1'));

    await act(() => store.selectVehicle('v2'));
    await waitFor(() => expect(vehicle()).toBe('v2'));
    expect(router.state.location.search).toMatchObject({ debug: '1' });

    await act(() => store.selectVehicle(null));
    await waitFor(() => expect(vehicle()).toBeUndefined());

    act(() => router.history.back());
    await waitFor(() => expect(store.getSnapshot().selectedVehicleId).toBe('v2'));
    act(() => router.history.back());
    await waitFor(() => expect(store.getSnapshot().selectedVehicleId).toBe('v1'));
    expect(api.selectVehicle.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2', null, 'v2', 'v1']);
  });
});
