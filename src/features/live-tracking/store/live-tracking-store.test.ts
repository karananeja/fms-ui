import type { Combinfo, Fleet, Me } from '@shared/contract/index.ts';
import { act, renderHook } from '@testing-library/react';
import { releaseProxy, type Remote } from 'comlink';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { INDIA_CITIES } from '../config/india-cities.ts';
import type {
  Bbox,
  FilterOptions,
  FleetNode,
  LivePush,
  LiveTrackingWorkerApi,
  MapFrame,
  Suggestion,
  VehicleFilter,
  VehicleSummary,
} from '../worker/worker-api.ts';
import { PULSE_INTERVAL_MS, PULSE_WINDOW_MS, pulseChange } from './fleet-pulse.ts';
import {
  LiveTrackingStore,
  hasPermission,
  normalizeFilter,
  selectedPosition,
  type LiveTrackingState,
  type LngLat,
  type MapCommand,
} from './live-tracking-store.ts';
import { useLiveTracking } from './use-live-tracking.ts';

const me = { fleetIds: ['f0'] } as unknown as Me;
const FLEETS: Fleet[] = [
  { id: 'f0', parentId: null, name: 'North', depth: 1, vehicleCount: 10 },
  { id: 'f1', parentId: 'f0', name: 'Delhi', depth: 2, vehicleCount: 4 },
];
const OPTIONS: FilterOptions = {
  assetTypes: ['Bus'],
  fuelTypes: ['Electric'],
  makes: ['Tata'],
  models: [{ make: 'Tata', model: 'Ultra' }],
};
const counts = (n = 0) =>
  Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, n])) as LivePush['statusCounts'];

const frame = (version: number, ids: string[] = [], lng = 77, lat = 12): MapFrame => ({
  version,
  zoom: 5,
  points: {
    lng: Float64Array.from(ids, () => lng),
    lat: Float64Array.from(ids, () => lat),
    heading: new Float32Array(ids.length),
    status: new Uint8Array(ids.length),
    ids,
    regnos: ids,
  },
  clusters: {
    lng: new Float64Array(),
    lat: new Float64Array(),
    id: new Float64Array(),
    count: new Uint32Array(),
    breakdown: new Uint32Array(),
  },
});

function fakeWorker() {
  let frameVersion = 0;
  let onPush: ((p: LivePush) => void) | undefined;
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn(async (id: string | null) => id !== 'missing'),
    getVehicleSummary: vi.fn<(id: string) => Promise<Partial<VehicleSummary> | null>>(
      async () => null,
    ),
    setViewport: vi.fn(async (): Promise<MapFrame | null> => frame(++frameVersion)),
    getBounds: vi.fn(async (): Promise<Bbox | null> => [72, 12, 88, 28]),
    getClusterExpansionZoom: vi.fn<(id: number) => Promise<number | null>>(async () => 9),
    dispose: vi.fn(async () => {}),
    setFilter: vi.fn<(f: VehicleFilter) => Promise<void>>(async () => {}),
    setFleets: vi.fn<(f: FleetNode[]) => Promise<void>>(async () => {}),
    suggest: vi.fn(async (): Promise<Suggestion[]> => []),
    getFilterOptions: vi.fn(async (): Promise<FilterOptions> => OPTIONS),
    [releaseProxy]: vi.fn(),
  };
  const createWorkerApi = vi.fn(() => api as unknown as Remote<LiveTrackingWorkerApi>);
  const fetchTrail = vi.fn(async (): Promise<LngLat[]> => [
    [77, 12],
    [77.1, 12.1],
  ]);
  const clock = { t: 1_000_000 };
  const fetchFleets = vi.fn(async (): Promise<Fleet[]> => FLEETS);
  const store = new LiveTrackingStore({
    createWorkerApi,
    fetchTrail,
    fetchFleets,
    now: () => clock.t,
  });
  const push = (over: Partial<LivePush> = {}, stats: Partial<LivePush['stats']> = {}) =>
    onPush!({
      connection: 'live',
      version: 1,
      statusCounts: counts(),
      total: 0,
      filteredCounts: counts(),
      filteredTotal: 0,
      selectedMatches: true,
      ...over,
      stats: { ...store.getSnapshot().stats, vehicleCount: 10, ...stats },
    });
  return { api, createWorkerApi, store, push, fetchTrail, clock };
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
    const selected = {
      vehicleId: 'v1',
      found: true,
      status: 'running' as const,
      combinfo: null,
      lafparsed: null,
    };
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

  it('F05-R4: exposes statusCounts and total; counts keep their identity while unchanged', () => {
    const { store, push } = fakeWorker();
    store.start(me);
    push({ statusCounts: counts(2), total: 16 });
    const first = store.getSnapshot().statusCounts;
    expect(first).toEqual(counts(2));
    expect(store.getSnapshot().total).toBe(16);
    push({ statusCounts: counts(2), total: 16 });
    expect(store.getSnapshot().statusCounts).toBe(first);
    push({ statusCounts: { ...counts(2), running: 3 }, total: 17 });
    expect(store.getSnapshot().statusCounts).toMatchObject({ running: 3, stopped: 2 });
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

const viewport = { bbox: [68, 6, 98, 36] as Bbox, zoom: 4 };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F06-T4: store map actions', () => {
  function started() {
    const t = fakeWorker();
    const commands: MapCommand[] = [];
    t.store.onMapCommand((c) => commands.push(c));
    t.store.start(me);
    return { ...t, commands };
  }

  it('setViewport stores the returned frame; newer push frames replace it, older ones do not', async () => {
    const { store, api, push } = started();
    await store.setViewport(viewport);
    expect(api.setViewport).toHaveBeenCalledWith(viewport);
    expect(store.getSnapshot().mapFrame?.version).toBe(1);
    push({ mapFrame: frame(5) });
    expect(store.getSnapshot().mapFrame?.version).toBe(5);
    push({ mapFrame: frame(3) });
    expect(store.getSnapshot().mapFrame?.version).toBe(5);
    await store.setViewport(null);
    expect(store.getSnapshot().mapFrame).toBeNull();
    push({ mapFrame: frame(9) });
    expect(store.getSnapshot().mapFrame).toBeNull();
  });

  it('locateVehicle selects and flies to the position at zoom 16; no position → toast', async () => {
    const { store, api, commands } = started();
    api.getVehicleSummary.mockResolvedValueOnce({ lat: 18.5, lng: 73.8 });
    await store.locateVehicle('v1');
    expect(api.selectVehicle).toHaveBeenCalledWith('v1');
    expect(store.getSnapshot().selectedVehicleId).toBe('v1');
    expect(commands).toEqual([{ type: 'fly', center: [73.8, 18.5], zoom: 16, duration: 1000 }]);

    api.getVehicleSummary.mockResolvedValueOnce({ lat: 0, lng: 0 });
    await store.locateVehicle('v2');
    expect(store.getSnapshot().selectedVehicleId).toBe('v2');
    expect(commands).toHaveLength(1);
    const notice = store.getSnapshot().notice!;
    expect(notice.message).toBe('No location available');
    store.dismissNotice(notice.id);
    expect(store.getSnapshot().notice).toBeNull();
  });

  it('fitToVehicles fits the bounds, flies to a single point, and does nothing when empty', async () => {
    const { store, api, commands } = started();
    expect(await store.fitToVehicles()).toBe(true);
    api.getBounds.mockResolvedValueOnce([73.8, 18.5, 73.8, 18.5]);
    await store.fitToVehicles();
    api.getBounds.mockResolvedValueOnce(null);
    expect(await store.fitToVehicles()).toBe(false);
    expect(commands).toEqual([
      { type: 'fit', bounds: [72, 12, 88, 28], padding: 48, maxZoom: 14 },
      { type: 'fly', center: [73.8, 18.5], zoom: 14, duration: 1000 },
    ]);
  });

  it('auto-fits once on the first completed snapshot, not after a reconnect', async () => {
    const { store, api, push, commands } = started();
    push({}, { snapshotComplete: true });
    await flush();
    expect(commands).toEqual([]); // no map yet
    await store.setViewport(viewport);
    await flush();
    expect(commands.map((c) => c.type)).toEqual(['fit']);
    expect(store.autoFitDone).toBe(true);
    push({ connection: 'reconnecting' }, { snapshotComplete: false });
    push({}, { snapshotComplete: true, reconnects: 1 });
    await store.setViewport(viewport);
    await flush();
    expect(commands).toHaveLength(1);
    expect(api.getBounds).toHaveBeenCalledTimes(1);
  });

  it('auto-fits when the snapshot completes after the map is up', async () => {
    const { store, push, commands } = started();
    await store.setViewport(viewport);
    push({}, { snapshotComplete: false });
    await flush();
    expect(commands).toEqual([]);
    push({}, { snapshotComplete: true });
    await flush();
    expect(commands).toHaveLength(1);
  });

  it('cluster click eases to the expansion zoom; city jump fits the city bbox', async () => {
    const { store, api, commands } = started();
    await store.zoomToCluster(42, [77, 12], 5);
    expect(api.getClusterExpansionZoom).toHaveBeenCalledWith(42);
    api.getClusterExpansionZoom.mockResolvedValueOnce(null);
    await store.zoomToCluster(43, [77, 12], 6.5);
    const pune = INDIA_CITIES.find((c) => c.name === 'Pune')!;
    store.jumpToCity(pune);
    expect(commands).toEqual([
      { type: 'ease', center: [77, 12], zoom: 9 },
      { type: 'ease', center: [77, 12], zoom: 8.5 },
      { type: 'fit', bounds: pune.bbox, padding: 0 },
    ]);
  });

  it('selectedPosition prefers the live payload, then the frame point', async () => {
    const { store, push } = started();
    await store.setViewport(viewport);
    await store.selectVehicle('v7');
    push({ mapFrame: frame(10, ['v6', 'v7'], 80, 20) });
    expect(selectedPosition(store.getSnapshot())).toEqual([80, 20]);
    const combinfo = { latitude: 21, longitude: 81 } as never;
    push({ selected: { vehicleId: 'v7', found: true, status: null, combinfo, lafparsed: null } });
    expect(selectedPosition(store.getSnapshot())).toEqual([81, 21]);
    await store.selectVehicle(null);
    expect(selectedPosition(store.getSnapshot())).toBeNull();
  });
});

describe('F07: permissions and the selected summary', () => {
  it('holds me.permissions from start', () => {
    const { store } = fakeWorker();
    store.start({ ...me, permissions: ['live.view', 'vehicle.details.view'] });
    const s = store.getSnapshot();
    expect(s.permissions).toEqual(['live.view', 'vehicle.details.view']);
    expect(hasPermission(s, 'vehicle.details.view')).toBe(true);
    expect(hasPermission(s, 'vehicle.parameters.view')).toBe(false);
  });

  it('fetches the summary after selecting; a newer selection wins; not found has none', async () => {
    const { store, api } = fakeWorker();
    store.start(me);
    api.getVehicleSummary.mockImplementation(async (id) => ({ vehicleId: id, regno: `R-${id}` }));
    await store.selectVehicle('v1');
    expect(store.getSnapshot().selectedSummary).toMatchObject({ regno: 'R-v1' });
    const first = store.selectVehicle('v2');
    await store.selectVehicle('v3');
    await first;
    expect(store.getSnapshot().selectedSummary).toMatchObject({ regno: 'R-v3' });
    await store.selectVehicle('missing');
    expect(store.getSnapshot()).toMatchObject({
      selectedSummary: null,
      selected: { found: false },
    });
  });
});

describe('F07: map click and resize', () => {
  it('R13/R16: vehicle click selects only with vehicle.details.view; empty click deselects', async () => {
    const { store, api } = fakeWorker();
    store.start({ ...me, permissions: ['live.view'] });
    store.clickMap('v1');
    expect(store.getSnapshot().selectedVehicleId).toBeNull();
    expect(api.selectVehicle).not.toHaveBeenCalled();

    const ok = fakeWorker();
    ok.store.start({ ...me, permissions: ['live.view', 'vehicle.details.view'] });
    ok.store.clickMap('v1');
    expect(ok.store.getSnapshot().selectedVehicleId).toBe('v1');
    ok.store.clickMap(null);
    expect(ok.store.getSnapshot().selectedVehicleId).toBeNull();
    ok.api.selectVehicle.mockClear();
    ok.store.clickMap(null);
    expect(ok.api.selectVehicle).not.toHaveBeenCalled();
  });

  it('resizeMap emits a resize command', () => {
    const { store } = fakeWorker();
    const cmds: MapCommand[] = [];
    store.onMapCommand((c) => cmds.push(c));
    store.resizeMap();
    expect(cmds).toEqual([{ type: 'resize' }]);
  });
});

describe('F07-R12: selected-vehicle trail', () => {
  it('fetches on select, appends live positions once, clears on deselect', async () => {
    const { store, push, fetchTrail } = fakeWorker();
    store.start({ fleetIds: ['f0'], permissions: [] } as unknown as Me);
    await store.selectVehicle('v1');
    expect(fetchTrail).toHaveBeenCalledWith('v1', 60);
    await vi.waitFor(() => expect(store.getSnapshot().trail).toHaveLength(2));
    const combinfo = { latitude: 12.2, longitude: 77.2 } as Combinfo;
    const selected = { vehicleId: 'v1', found: true, status: null, combinfo, lafparsed: null };
    push({ selected });
    push({ selected: { ...selected } });
    expect(store.getSnapshot().trail).toEqual([
      [77, 12],
      [77.1, 12.1],
      [77.2, 12.2],
    ]);
    await store.selectVehicle(null);
    expect(store.getSnapshot().trail).toBeNull();
  });
});

describe('F08-T5: store filter + pulse', () => {
  it('toggleStatus adds and removes statuses in VEHICLE_STATUSES order; ALL clears', () => {
    const { store, api } = fakeWorker();
    store.start(me);
    store.toggleStatus('charging');
    store.toggleStatus('running');
    expect(store.getSnapshot().filter).toEqual({ statuses: ['running', 'charging'] });
    store.toggleStatus('charging');
    expect(store.getSnapshot().filter).toEqual({ statuses: ['running'] });
    store.toggleStatus(null);
    expect(store.getSnapshot().filter).toEqual({});
    expect(api.setFilter).toHaveBeenLastCalledWith({});
  });

  it('patchFilter merges and normalises; clearFilter empties; no-op changes are not sent', () => {
    const { store, api } = fakeWorker();
    store.start(me);
    store.patchFilter({ fleetIds: ['f1'], socMin: 20, socMax: 100 });
    store.patchFilter({ search: { field: 'regno', prefix: ' ka01 ' }, assetTypes: [] });
    expect(store.getSnapshot().filter).toEqual({
      fleetIds: ['f1'],
      socMin: 20,
      search: { field: 'regno', prefix: 'ka01' },
    });
    const calls = api.setFilter.mock.calls.length;
    store.patchFilter({ assetTypes: [] });
    expect(api.setFilter.mock.calls.length).toBe(calls);
    store.clearFilter();
    expect(store.getSnapshot().filter).toEqual({});
    expect(
      normalizeFilter({ socMin: 0, socMax: 100, search: { field: 'all', prefix: ' ' } }),
    ).toEqual({});
  });

  it('loads permitted fleets into state and the worker', async () => {
    const { store, api } = fakeWorker();
    store.start(me);
    await vi.waitFor(() => expect(store.getSnapshot().fleets).toEqual(FLEETS));
    expect(api.setFleets).toHaveBeenCalledWith([
      { id: 'f0', parentId: null },
      { id: 'f1', parentId: 'f0' },
    ]);
  });

  it('takes filtered counts, hidden selection and filter options from the worker', async () => {
    const { store, push } = fakeWorker();
    store.start(me);
    push({ filteredCounts: counts(2), filteredTotal: 16, selectedMatches: true });
    expect(store.getSnapshot()).toMatchObject({ filteredTotal: 16, selectedHidden: false });
    expect(store.getSnapshot().filteredCounts.running).toBe(2);
    await store.selectVehicle('v1');
    push({
      selectedMatches: false,
      selected: {
        vehicleId: 'v1',
        found: true,
        status: 'running',
        combinfo: null,
        lafparsed: null,
      },
    });
    expect(store.getSnapshot().selectedHidden).toBe(true);
    expect(selectedPosition(store.getSnapshot())).toBeNull();
    await store.loadFilterOptions();
    expect(store.getSnapshot().filterOptions).toEqual(OPTIONS);
  });

  it('pulse samples every 10 s after the snapshot, keeps 1 h, and restarts on a new scope', () => {
    const { store, push, clock } = fakeWorker();
    store.start(me);
    const tick = (running: number) =>
      push({ filteredCounts: { ...counts(), running } }, { snapshotComplete: true });
    push({}, { snapshotComplete: false });
    expect(store.getSnapshot().pulse).toEqual([]);
    tick(10);
    clock.t += 4000;
    tick(11); // < 10 s: not sampled
    expect(store.getSnapshot().pulse.map((s) => s.v)).toEqual([10]);
    for (let k = 0; k < 400; k++) {
      clock.t += PULSE_INTERVAL_MS;
      tick(10 + (k % 3));
    }
    const pulse = store.getSnapshot().pulse;
    expect(pulse.length).toBe(PULSE_WINDOW_MS / PULSE_INTERVAL_MS + 1);
    expect(pulse.at(-1)!.t - pulse[0]!.t).toBe(PULSE_WINDOW_MS);
    expect(
      pulseChange([
        { t: 0, v: 50 },
        { t: 1, v: 55 },
      ]),
    ).toBeCloseTo(10);
    expect(pulseChange([{ t: 0, v: 50 }])).toBeNull();

    store.toggleStatus('running'); // statuses don't change the running count's scope
    expect(store.getSnapshot().pulse).toBe(pulse);
    store.patchFilter({ fleetIds: ['f1'] });
    expect(store.getSnapshot().pulse).toEqual([]);
  });
});
