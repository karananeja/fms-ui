import type { Fleet, VehicleMeta } from '@shared/contract/index.ts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import {
  addChildBlocker,
  buildFleetIndex,
  deleteBlocker,
  maxParentDepthFor,
  moveBlocker,
  visibleRows,
  withMove,
} from './fleet-tree-model';
import { FleetTreeStore, type FleetApi, type Notifier } from './fleet-tree-store';
import { FleetVehiclesStore, VEHICLE_PAGE_SIZE } from './fleet-vehicles-store';

const f = (id: string, parentId: string | null, depth: number, vehicleCount: number): Fleet => ({
  id,
  parentId,
  name: id.toUpperCase(),
  depth,
  vehicleCount,
});

/** r ─ a ─ a1 ─ a1x ─ a1xy (depth 5) · a ─ a2 (empty leaf) · r ─ b (4 direct vehicles). */
const FLEETS: Fleet[] = [
  f('r', null, 1, 10),
  f('a', 'r', 2, 6),
  f('a1', 'a', 3, 4),
  f('a1x', 'a1', 4, 1),
  f('a1xy', 'a1x', 5, 1),
  f('a2', 'a', 3, 0),
  f('b', 'r', 2, 4),
];

const ids = (rows: readonly { fleet: Fleet }[]) => rows.map((r) => r.fleet.id);
const all = () => true;

function fakeApi(overrides: Partial<FleetApi> = {}): FleetApi {
  return {
    listFleets: vi.fn(async () => FLEETS),
    createFleet: vi.fn(async ({ parentId, name }) => ({
      id: 'new1',
      parentId,
      name,
      depth: 3,
      vehicleCount: 0,
    })),
    renameFleet: vi.fn(async (id: string, name: string) => ({ ...f(id, null, 1, 0), name })),
    moveFleet: vi.fn(async (id: string) => f(id, null, 1, 0)),
    deleteFleet: vi.fn(async () => undefined),
    listVehicles: vi.fn(async () => ({ items: [], nextCursor: null })),
    moveVehicles: vi.fn(async (_id: string, vehicleIds: string[]) => ({
      moved: vehicleIds.length,
    })),
    ...overrides,
  };
}

const notifier = () => ({
  success: vi.fn<Notifier['success']>(),
  error: vi.fn<Notifier['error']>(),
});

async function loaded(api = fakeApi(), notify = notifier()) {
  const store = new FleetTreeStore(api, notify);
  await store.load();
  return { store, api, notify, s: () => store.getSnapshot() };
}

describe('F03-T2 fleet tree model', () => {
  it('builds the tree from the flat list with heights and direct counts', () => {
    const index = buildFleetIndex(FLEETS);
    expect(index.roots.map((r) => r.id)).toEqual(['r']);
    expect(index.children.get('a')!.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(index.height.get('r')).toBe(5);
    expect(index.height.get('a1')).toBe(3);
    expect(index.height.get('b')).toBe(1);
    expect(index.direct.get('a1')).toBe(3);
    expect(index.direct.get('a')).toBe(2);
    expect(index.direct.get('r')).toBe(0);
  });

  it('treats a scoped list (parent missing) as its own forest', () => {
    const index = buildFleetIndex(FLEETS.filter((x) => x.id !== 'r'));
    expect(index.roots.map((r) => r.id)).toEqual(['a', 'b']);
    expect(moveBlocker(index, index.byId.get('a')!)).toMatch(/root/);
  });

  it('shows only expanded subtrees, with ARIA positions', () => {
    const index = buildFleetIndex(FLEETS);
    const rows = visibleRows(index, { isExpanded: (id) => id === 'r' });
    expect(ids(rows)).toEqual(['r', 'a', 'b']);
    expect(rows[1]).toMatchObject({ level: 2, posInSet: 1, setSize: 2, expanded: false });
    expect(ids(visibleRows(index, { isExpanded: all }))).toEqual(FLEETS.map((x) => x.id));
  });

  it('search keeps matches and their ancestors, ignoring collapsed state', () => {
    const index = buildFleetIndex(FLEETS);
    const rows = visibleRows(index, { isExpanded: () => false, query: 'a1x' });
    expect(ids(rows)).toEqual(['r', 'a', 'a1', 'a1x', 'a1xy']);
    expect(rows.filter((r) => r.match).map((r) => r.fleet.id)).toEqual(['a1x', 'a1xy']);
    expect(ids(visibleRows(index, { isExpanded: all, query: 'zzz' }))).toEqual([]);
  });

  it('depth-5 rule: no child under depth 5; move targets limited by subtree height', () => {
    const index = buildFleetIndex(FLEETS);
    expect(addChildBlocker(index.byId.get('a1xy')!)).toMatch(/at most 5 levels/);
    expect(addChildBlocker(index.byId.get('a1x')!)).toBeNull();
    // a1 has 3 levels, so its new parent may be at most depth 2.
    expect(maxParentDepthFor(index, 'a1')).toBe(2);
    expect(maxParentDepthFor(index, 'b')).toBe(4);
  });

  it('move targets exclude the own subtree and too-deep parents', () => {
    const index = buildFleetIndex(FLEETS);
    const rows = visibleRows(index, {
      isExpanded: all,
      excludeSubtreeOf: 'a1',
      maxDepth: maxParentDepthFor(index, 'a1'),
    });
    expect(ids(rows)).toEqual(['r', 'a', 'b']);
  });

  it('delete only an empty leaf, with the reason otherwise; the root is fixed', () => {
    const index = buildFleetIndex(FLEETS);
    expect(deleteBlocker(index, index.byId.get('a2')!)).toBeNull();
    expect(deleteBlocker(index, index.byId.get('b')!)).toBe('Still has vehicles');
    expect(deleteBlocker(index, index.byId.get('a1x')!)).toBe('Still has child fleets');
    expect(deleteBlocker(index, index.byId.get('r')!)).toMatch(/root/);
    expect(moveBlocker(index, index.byId.get('r')!)).toMatch(/root/);
  });

  it('withMove shifts depths and re-aggregates counts', () => {
    const next = buildFleetIndex(withMove(FLEETS, 'a1', 'b'));
    expect(next.byId.get('a1')).toMatchObject({ parentId: 'b', depth: 3, vehicleCount: 4 });
    expect(next.byId.get('a1xy')!.depth).toBe(5);
    expect(next.byId.get('a')!.vehicleCount).toBe(2);
    expect(next.byId.get('b')!.vehicleCount).toBe(8);
    expect(next.byId.get('r')!.vehicleCount).toBe(10);
  });
});

describe('F03-T2 FleetTreeStore', () => {
  it('loads, expands the top two levels and selects the root', async () => {
    const { s } = await loaded();
    expect(s().status).toBe('ready');
    expect(s().selectedId).toBe('r');
    expect(ids(s().rows)).toEqual(['r', 'a', 'a1', 'a2', 'b']);
  });

  it('expand / collapse / expand all / search', async () => {
    const { store, s } = await loaded();
    store.toggle('a');
    expect(ids(s().rows)).toEqual(['r', 'a', 'b']);
    store.expandAll();
    expect(s().rows).toHaveLength(FLEETS.length);
    store.collapseAll();
    expect(ids(s().rows)).toEqual(['r']);
    store.setQuery('a2');
    expect(ids(s().rows)).toEqual(['r', 'a', 'a2']);
  });

  it('create is optimistic and takes the server id', async () => {
    let resolve!: (v: Fleet) => void;
    const api = fakeApi({ createFleet: vi.fn(() => new Promise<Fleet>((r) => (resolve = r))) });
    const { store, s } = await loaded(api);
    const done = store.create('a2', '  New  ');
    expect(s().fleets.at(-1)).toMatchObject({ parentId: 'a2', name: 'New', depth: 4 });
    expect(s().expanded.has('a2')).toBe(true);
    resolve(f('n9', 'a2', 4, 0));
    await done;
    expect(s().fleets.at(-1)!.id).toBe('n9');
    expect(api.createFleet).toHaveBeenCalledWith({ parentId: 'a2', name: 'New' });
  });

  it('refuses a child at depth 5 without calling the server', async () => {
    const { store, api, notify } = await loaded();
    expect(await store.create('a1xy', 'Too deep')).toBeNull();
    expect(api.createFleet).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(expect.stringMatching(/5 levels/));
  });

  it('rename reverts on 409 and toasts the server message', async () => {
    const api = fakeApi({
      renameFleet: vi.fn(async () => {
        throw new ApiError(409, 'conflict', 'Name taken');
      }),
    });
    const { store, s, notify } = await loaded(api);
    const done = store.rename('b', 'Bee');
    expect(s().index.byId.get('b')!.name).toBe('Bee');
    expect(await done).toBe(false);
    expect(s().index.byId.get('b')!.name).toBe('B');
    expect(notify.error).toHaveBeenCalledWith('Name taken');
  });

  it('move is optimistic and reverts on 422', async () => {
    let reject!: (e: unknown) => void;
    const api = fakeApi({ moveFleet: vi.fn(() => new Promise<Fleet>((_, r) => (reject = r))) });
    const { store, s, notify } = await loaded(api);
    const done = store.move('a1', 'b');
    expect(s().index.byId.get('a1')!.parentId).toBe('b');
    expect(s().index.byId.get('b')!.vehicleCount).toBe(8);
    reject(new ApiError(422, 'max_depth', 'Fleets can be nested at most 5 levels deep'));
    expect(await done).toBe(false);
    expect(s().index.byId.get('a1')).toMatchObject({ parentId: 'a', depth: 3 });
    expect(s().index.byId.get('b')!.vehicleCount).toBe(4);
    expect(notify.error).toHaveBeenCalledWith('Fleets can be nested at most 5 levels deep');
  });

  it('a failed change keeps a later successful one', async () => {
    let reject!: (e: unknown) => void;
    const api = fakeApi({
      moveFleet: vi.fn(() => new Promise<Fleet>((_, r) => (reject = r))),
    });
    const { store, s } = await loaded(api);
    const move = store.move('a2', 'b');
    await store.rename('b', 'Bee');
    reject(new ApiError(409, 'conflict', 'nope'));
    await move;
    expect(s().index.byId.get('a2')!.parentId).toBe('a');
    expect(s().index.byId.get('b')!.name).toBe('Bee');
  });

  it('delete removes an empty leaf, refuses others, and reverts on 409', async () => {
    const api = fakeApi({
      deleteFleet: vi.fn(async () => {
        throw new ApiError(409, 'conflict', 'Fleet still has vehicles');
      }),
    });
    const { store, s, notify } = await loaded(api);
    expect(await store.remove('b')).toBe(false);
    expect(api.deleteFleet).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenLastCalledWith('Still has vehicles');
    store.select('a2');
    const done = store.remove('a2');
    expect(s().index.byId.has('a2')).toBe(false);
    expect(s().selectedId).toBe('a');
    await done;
    expect(ids(s().rows)).toEqual(['r', 'a', 'a1', 'a2', 'b']);
    expect(s().selectedId).toBe('a2');
    expect(notify.error).toHaveBeenLastCalledWith('Fleet still has vehicles');
  });
});

const vehicle = (i: number): VehicleMeta => ({
  vehicleId: `v${i}`,
  deviceId: `d${i}`,
  regno: `KA01${i}`,
  vin: `VIN${String(i).padStart(14, '0')}`,
  fleetId: 'b',
  assetType: 'car',
  fuelType: 'ev',
  make: 'm',
  model: 'm',
  variant: 'v',
});

describe('F03-T2 FleetVehiclesStore', () => {
  const pages = (n: number) =>
    vi.fn(async ({ cursor }: { cursor?: string } = {}) => {
      const from = cursor ? Number(cursor) : 0;
      const items = Array.from({ length: Math.min(VEHICLE_PAGE_SIZE, n - from) }, (_, k) =>
        vehicle(from + k),
      );
      const next = from + items.length;
      return { items, nextCursor: next < n ? String(next) : null };
    });

  it('loads cursor pages of 100 until the last one', async () => {
    const listVehicles = pages(150);
    const store = new FleetVehiclesStore(fakeApi({ listVehicles }), notifier());
    store.open('b');
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(100));
    expect(listVehicles).toHaveBeenCalledWith(
      { fleetId: 'b', q: '', cursor: undefined, limit: 100 },
      expect.anything(),
    );
    await store.loadMore();
    expect(store.getSnapshot()).toMatchObject({ nextCursor: null });
    expect(store.getSnapshot().items).toHaveLength(150);
    await store.loadMore();
    expect(listVehicles).toHaveBeenCalledTimes(2);
  });

  it('drops a stale page after the fleet changes', async () => {
    let resolve!: (v: { items: VehicleMeta[]; nextCursor: null }) => void;
    const listVehicles = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockImplementation(async () => ({ items: [vehicle(7)], nextCursor: null }));
    const store = new FleetVehiclesStore(fakeApi({ listVehicles }), notifier());
    store.open('a');
    store.open('b');
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(1));
    resolve({ items: [vehicle(1), vehicle(2)], nextCursor: null });
    await Promise.resolve();
    expect(store.getSnapshot().items.map((v) => v.vehicleId)).toEqual(['v7']);
  });

  it('checkbox, shift-range and select page', async () => {
    const store = new FleetVehiclesStore(fakeApi({ listVehicles: pages(10) }), notifier());
    store.open('b');
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(10));
    store.toggle(1);
    store.toggle(4, true);
    expect([...store.getSnapshot().selected]).toEqual(['v1', 'v2', 'v3', 'v4']);
    store.toggle(2);
    expect(store.getSnapshot().selected.has('v2')).toBe(false);
    store.toggleAll();
    expect(store.getSnapshot().selected.size).toBe(10);
    store.toggleAll();
    expect(store.getSnapshot().selected.size).toBe(0);
  });

  it('moves the selection, toasts "Moved N vehicles", drops them and refreshes counts', async () => {
    const notify = notifier();
    const onMoved = vi.fn();
    const api = fakeApi({ listVehicles: pages(5) });
    const store = new FleetVehiclesStore(api, notify, onMoved);
    store.open('b');
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(5));
    store.toggle(0);
    store.toggle(2, true);
    expect(await store.moveSelected('a2')).toBe(true);
    expect(api.moveVehicles).toHaveBeenCalledWith('a2', ['v0', 'v1', 'v2']);
    expect(notify.success).toHaveBeenCalledWith('Moved 3 vehicles');
    expect(store.getSnapshot().items.map((v) => v.vehicleId)).toEqual(['v3', 'v4']);
    expect(store.getSnapshot().selected.size).toBe(0);
    expect(onMoved).toHaveBeenCalled();
  });

  it('keeps the selection and toasts the server message when the move fails', async () => {
    const notify = notifier();
    const api = fakeApi({
      listVehicles: pages(3),
      moveVehicles: vi.fn(async () => {
        throw new ApiError(403, 'forbidden', 'Fleet out of scope');
      }),
    });
    const store = new FleetVehiclesStore(api, notify);
    store.open('b');
    await vi.waitFor(() => expect(store.getSnapshot().items).toHaveLength(3));
    store.toggle(0);
    expect(await store.moveSelected('a2')).toBe(false);
    expect(notify.error).toHaveBeenCalledWith('Fleet out of scope');
    expect(store.getSnapshot().selected.size).toBe(1);
  });
});
