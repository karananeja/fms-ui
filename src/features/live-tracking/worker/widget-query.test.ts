// @vitest-environment node
import type { Me } from '@shared/contract/index.ts';
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableSort } from '../config/table-columns.ts';
import { LiveTrackingEngine, SUB_FLEET_COMBINFO } from './live-tracking-engine.ts';
import { fakeSockets, snapshotRow } from './testing/fake-socket.ts';
import type { LiveListFilter } from './widget-query.ts';
import type { LivePush } from './worker-api.ts';

const me = { fleetIds: ['root'], permissions: ['live.view'] } as unknown as Me;
const FLEETS = [
  { id: 'root', parentId: null },
  { id: 'f0', parentId: 'root' },
  { id: 'f1', parentId: 'root' },
  { id: 'f0a', parentId: 'f0' },
];
const FLEET_IDS = ['f0', 'f1', 'f0a'];
const ASSETS = ['Bus', 'Car', '3W'];
const MAKES = ['Tata', 'Mahindra', 'Ola'];

function setup(n: number, seed: number) {
  const s = fakeSockets();
  const pushes: LivePush[] = [];
  const engine = new LiveTrackingEngine({
    url: 'ws://test/ws/live',
    createSocket: s.create,
    random: () => 1,
  });
  engine.init(me, (p) => pushes.push(p));
  s.last().open();
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  const rows = Array.from({ length: n }, (_, i) =>
    snapshotRow(i, {
      fleetId: FLEET_IDS[Math.floor(rnd() * 3)],
      assetType: ASSETS[Math.floor(rnd() * 3)],
      fuelType: rnd() < 0.5 ? 'Electric' : 'CNG',
      make: MAKES[Math.floor(rnd() * 3)],
      soc: Math.floor(rnd() * 101),
      speed: rnd() < 0.4 ? 0 : Math.floor(rnd() * 80),
      odometer: Math.floor(rnd() * 1e5),
      regno: `KA${String(Math.floor(rnd() * 1e4)).padStart(4, '0')}`,
    }),
  );
  s.last().message({
    type: 'snapshot',
    id: SUB_FLEET_COMBINFO,
    seq: 1,
    chunk: 0,
    chunks: 1,
    fields: COMBINFO_SNAPSHOT_FIELDS,
    rows,
  });
  engine.setFleets(FLEETS);
  return { engine, pushes };
}

let engine: LiveTrackingEngine | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  engine?.dispose();
  vi.useRealTimers();
});

const FILTERS: LiveListFilter[] = [
  {},
  { statuses: ['running'] },
  { fleetIds: ['f0'] },
  { fleetIds: ['f1'], assetTypes: ['Bus', 'Car'] },
  { makes: ['Tata'], fuelTypes: ['Electric'], socMin: 20, socMax: 60 },
  { statuses: ['stopped', 'running'], fleetIds: ['root'], socMax: 50 },
];
const SORTS: TableSort[] = [
  { column: 'regno', dir: 'asc' },
  { column: 'soc', dir: 'desc' },
  { column: 'speed', dir: 'asc' },
  { column: 'odometer', dir: 'desc' },
  { column: 'status', dir: 'asc' },
];

describe('F20-T4: queryWidgets (D-129)', () => {
  it('list parity with FilterEngine + table order, fleet subtrees, top-k both directions', () => {
    for (const seed of [3, 17, 99]) {
      const t = setup(400, seed);
      engine = t.engine;
      for (const filter of FILTERS) {
        for (const sort of SORTS) {
          const batch = engine.queryWidgets([{ kind: 'list', filter, sort, limit: 25 }]);
          engine.setFilter(filter);
          const table = engine.queryTable({ scope: 'all', sort, offset: 0, limit: 25 });
          const r = batch.results![0]!;
          expect(r.kind).toBe('list');
          if (r.kind !== 'list') continue;
          expect(r.total).toBe(table.total);
          expect(r.rows.map((x) => x.vehicleId)).toEqual(table.rows.map((x) => x.vehicleId));
        }
      }
      engine.setFilter({});
      engine.dispose();
    }
    engine = undefined;
  });

  it('counts: global = status bar, per fleet = FilterEngine over the subtree', () => {
    const t = setup(300, 5);
    engine = t.engine;
    const b = engine.queryWidgets([{ kind: 'counts' }, { kind: 'counts', fleetId: 'f0' }]);
    expect(b.ready).toBe(true);
    const [all, f0] = b.results!;
    expect(all).toEqual({ kind: 'counts', counts: engine.status.statusCounts(), total: 300 });
    engine.setFilter({ fleetIds: ['f0'] });
    const expected = engine.filters.counts();
    expect(f0).toEqual({ kind: 'counts', counts: expected.counts, total: expected.total });
    // f0 includes f0a (subtree).
    const sum = VEHICLE_STATUSES.reduce(
      (s, k) => s + (f0 as { counts: Record<string, number> }).counts[k]!,
      0,
    );
    expect(sum).toBe(expected.total);
  });

  it('sinceVersion short-circuits; results are cached per version', () => {
    const t = setup(200, 9);
    engine = t.engine;
    const q = [{ kind: 'list' as const, filter: { fleetIds: ['f1'] }, sort: SORTS[1]!, limit: 10 }];
    const a = engine.queryWidgets(q);
    const scans = engine.widgets.scans;
    const again = engine.queryWidgets(q);
    expect(again.results![0]).toBe(a.results![0]);
    expect(engine.widgets.scans).toBe(scans);
    expect(engine.queryWidgets(q, a.version)).toEqual({
      version: a.version,
      ready: true,
      results: null,
    });
  });

  it('never touches the global filter, counts, table cache, tray or selection', () => {
    const t = setup(300, 11);
    engine = t.engine;
    engine.setFilter({ statuses: ['running'] });
    engine.selectVehicle('v3');
    vi.advanceTimersByTime(1000);
    const before = {
      filter: engine.filters.current,
      version: engine.filters.version,
      counts: engine.filters.counts(),
      table: engine.queryTable({ scope: 'all', sort: SORTS[0]!, offset: 0, limit: 50 }),
      tray: engine.getTray([-180, -90, 180, 90], 20),
      sorts: engine.table.sorts,
      pushes: t.pushes.length,
    };
    for (const filter of FILTERS)
      engine.queryWidgets([
        { kind: 'list', filter, sort: SORTS[2]!, limit: 50 },
        { kind: 'counts', fleetId: 'f1' },
      ]);
    expect(engine.filters.current).toBe(before.filter);
    expect(engine.filters.version).toBe(before.version);
    expect(engine.filters.counts()).toEqual(before.counts);
    expect(engine.queryTable({ scope: 'all', sort: SORTS[0]!, offset: 0, limit: 50 })).toEqual(
      before.table,
    );
    expect(engine.table.sorts).toBe(before.sorts);
    expect(engine.getTray([-180, -90, 180, 90], 20)).toEqual(before.tray);
    expect(t.pushes.length).toBe(before.pushes);
    vi.advanceTimersByTime(1000);
    expect(t.pushes.at(-1)!.filteredCounts).toEqual(before.counts.counts);
  });
});
