// @vitest-environment node
import { COMBINFO_LEAVE_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FilterEngine, isEmptyFilter, type VehicleFilter } from './filter-engine.ts';
import { FleetState } from './fleet-state.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';

const FLEETS = [
  { id: 'root', parentId: null },
  { id: 'f0', parentId: 'root' },
  { id: 'f1', parentId: 'root' },
  { id: 'f0a', parentId: 'f0' },
  { id: 'f0a1', parentId: 'f0a' },
];
const FLEET_IDS = ['f0', 'f1', 'f0a', 'f0a1'];
const ASSETS = ['Bus', 'Car', '3W'];
const FUELS = ['Electric', 'CNG'];
const MAKES = ['Tata', 'Mahindra'];

/** Vehicle `n`'s attributes cycle through the lists above; even ids run, odd ones stop. */
const attrs = (n: number, over: Record<string, unknown> = {}) => ({
  fleetId: FLEET_IDS[n % FLEET_IDS.length],
  assetType: ASSETS[n % ASSETS.length],
  fuelType: FUELS[n % FUELS.length],
  make: MAKES[n % MAKES.length],
  model: `${MAKES[n % MAKES.length]}-M${n % 3}`,
  soc: (n * 7) % 101,
  speed: n % 2 ? 0 : 20,
  ...over,
});

function setup(capacity = 8) {
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity });
  const tracker = new StatusTracker(state, statusRulesConfig);
  tracker.now = BASE_T;
  const filters = new FilterEngine(state);
  filters.setFleets(FLEETS);
  const put = (ns: number[], over: Record<string, unknown> = {}) =>
    state.applyCombinfo(
      COMBINFO_SNAPSHOT_FIELDS,
      ns.map((n) => snapshotRow(n, attrs(n, over))),
    );
  const ids = () =>
    state.str.vehicleId
      .filter((_, i) => filters.matches(i))
      .map((v) => Number(v.slice(1)))
      .sort((a, b) => a - b);
  return { state, tracker, filters, put, ids };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const subtree: Record<string, string[]> = {
  root: ['root', ...FLEET_IDS],
  f0: ['f0', 'f0a', 'f0a1'],
  f0a: ['f0a', 'f0a1'],
};

/** Reference predicate over a vehicle's raw values. */
function reference(
  f: VehicleFilter,
  v: ReturnType<typeof attrs> & {
    regno: string;
    vin: string;
    deviceId: string;
    status: VehicleStatus;
  },
) {
  const inList = (list: readonly string[] | undefined, x: string) =>
    !list?.length || list.includes(x);
  const fleets = f.fleetIds?.flatMap((id) => subtree[id] ?? [id]);
  const p = f.search?.prefix.trim().toUpperCase();
  const fields =
    f.search?.field === 'all'
      ? (['regno', 'vin', 'deviceId'] as const)
      : f.search
        ? [f.search.field]
        : [];
  return (
    inList(f.statuses, v.status) &&
    inList(fleets, v.fleetId!) &&
    inList(f.assetTypes, v.assetType!) &&
    inList(f.fuelTypes, v.fuelType!) &&
    inList(f.makes, v.make!) &&
    inList(f.models, v.model) &&
    (f.socMin === undefined || v.soc >= f.socMin) &&
    (f.socMax === undefined || v.soc <= f.socMax) &&
    (!p || fields.some((k) => (v[k as 'regno'] as string).toUpperCase().startsWith(p)))
  );
}

describe('F08-T1: filter-engine', () => {
  it('an empty filter matches everything', () => {
    const { filters, put, ids } = setup();
    put(range(6));
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ search: { field: 'all', prefix: '  ' } })).toBe(true);
    expect(filters.active).toBe(false);
    expect(ids()).toEqual(range(6));
    expect(filters.matchCount).toBe(6);
  });

  it.each<[string, VehicleFilter, number[]]>([
    ['status', { statuses: ['running'] }, [0, 2, 4, 6, 8, 10]],
    ['status OR', { statuses: ['running', 'stopped'] }, range(12)],
    ['asset type', { assetTypes: ['Car'] }, [1, 4, 7, 10]],
    ['asset type OR', { assetTypes: ['Car', '3W'] }, [1, 2, 4, 5, 7, 8, 10, 11]],
    ['fuel type', { fuelTypes: ['CNG'] }, [1, 3, 5, 7, 9, 11]],
    ['make', { makes: ['Tata'] }, [0, 2, 4, 6, 8, 10]],
    ['model', { models: ['Tata-M0'] }, [0, 6]],
    ['soc min', { socMin: 50 }, [8, 9, 10, 11]],
    ['soc range', { socMin: 10, socMax: 30 }, [2, 3, 4]],
    [
      'regno prefix (case-insensitive)',
      { search: { field: 'regno', prefix: 'ka01ab000' } },
      range(10),
    ],
    ['vin prefix', { search: { field: 'vin', prefix: 'VIN1' } }, [1, 10, 11]],
    ['device prefix', { search: { field: 'deviceId', prefix: 'd1' } }, [1, 10, 11]],
    ['all fields prefix', { search: { field: 'all', prefix: 'd11' } }, [11]],
    [
      'AND across fields',
      { assetTypes: ['Bus'], fuelTypes: ['Electric'], statuses: ['running'] },
      [0, 6],
    ],
  ])('%s', (_, filter, expected) => {
    const { filters, put, ids } = setup();
    put(range(12));
    filters.set(filter);
    expect(ids()).toEqual(expected);
    expect(filters.matchCount).toBe(expected.length);
  });

  it('fleet ids include their whole subtree', () => {
    const { filters, put, ids } = setup();
    put(range(8));
    filters.set({ fleetIds: ['f0'] }); // f0 + f0a + f0a1
    expect(ids()).toEqual([0, 2, 3, 4, 6, 7]);
    filters.set({ fleetIds: ['f0a'] });
    expect(ids()).toEqual([2, 3, 6, 7]);
    filters.set({ fleetIds: ['f1', 'f0a1'] });
    expect(ids()).toEqual([1, 3, 5, 7]);
    filters.set({ fleetIds: ['root'] });
    expect(ids()).toEqual(range(8));
  });

  it('counts leave out the status filter; the total includes it', () => {
    const { filters, put } = setup();
    put(range(12));
    filters.set({ assetTypes: ['Bus'], statuses: ['running'] }); // Bus = 0,3,6,9
    const { counts, total } = filters.counts();
    expect(counts.running).toBe(2); // 0, 6
    expect(counts.stopped).toBe(2); // 3, 9
    expect(total).toBe(2);
    expect(VEHICLE_STATUSES.reduce((a, s) => a + counts[s], 0)).toBe(4);
  });

  it('status changes are seen without re-applying the filter', () => {
    const { filters, put, ids } = setup();
    put(range(4));
    filters.set({ statuses: ['running'] });
    expect(ids()).toEqual([0, 2]);
    put([1], { speed: 30 });
    expect(ids()).toEqual([0, 1, 2]);
    expect(filters.counts().total).toBe(3);
  });

  it('version bumps on filter changes and when a row starts or stops matching', () => {
    const { filters, put } = setup();
    put(range(4));
    const v0 = filters.version;
    filters.set({ socMin: 15 });
    expect(filters.version).toBe(v0 + 1);
    put([0], { soc: 90 }); // 0 starts matching
    expect(filters.version).toBe(v0 + 2);
    put([0], { soc: 95 }); // still matching
    expect(filters.version).toBe(v0 + 2);
  });

  it('stays consistent with a reference across random insert, update and remove', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const { state, tracker, filters, put } = setup(2);
    const filtersToTry: VehicleFilter[] = [
      { fleetIds: ['f0'], socMin: 20 },
      { statuses: ['stopped'], makes: ['Tata'] },
      { assetTypes: ['Car', '3W'], search: { field: 'all', prefix: 'ka01ab00' } },
      { models: ['Mahindra-M1', 'Tata-M2'], socMax: 60 },
    ];
    const live = new Map<number, Record<string, unknown>>();
    for (const filter of filtersToTry) {
      filters.set(filter);
      for (let step = 0; step < 400; step++) {
        const n = Math.floor(rnd() * 60);
        const r = rnd();
        if (r < 0.2 && live.has(n)) {
          state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [[`v${n}`, null]]);
          live.delete(n);
        } else {
          const over = {
            soc: Math.floor(rnd() * 101),
            speed: pick([0, 20]),
            assetType: pick(ASSETS),
          };
          put([n], over);
          live.set(n, over);
        }
      }
      expect(state.count).toBe(live.size);
      for (let i = 0; i < state.count; i++) {
        const n = Number(state.str.vehicleId[i]!.slice(1));
        const v = {
          ...attrs(n, live.get(n)),
          regno: state.str.regno[i]!,
          vin: state.str.vin[i]!,
          deviceId: state.str.deviceId[i]!,
          status: tracker.statusOf(i)!,
        };
        expect(filters.matches(i), `v${n} with ${JSON.stringify(filter)}`).toBe(
          reference(filter, v),
        );
      }
    }
  });

  it('keeps matching rows added after the fleet state grows (regression)', () => {
    const state = new FleetState({ pids: [], capacity: 2 });
    const filters = new FilterEngine(state);
    filters.set({ fleetIds: ['f0'], socMin: 50, search: { field: 'regno', prefix: 'ka01' } });
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(0), snapshotRow(1)]);
    // Capacity 2 → 4 → 8: dict codes, soc and strings are reallocated.
    state.applyCombinfo(
      COMBINFO_SNAPSHOT_FIELDS,
      [2, 3, 4, 5, 6].map((n) => snapshotRow(n)),
    );
    expect(state.capacity).toBe(8);
    const matching = () => state.str.vehicleId.filter((_, i) => filters.matches(i)).sort();
    expect(matching()).toEqual(['v0', 'v2', 'v4', 'v6']);

    // An update after growth is re-checked against the live columns too.
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(6, { soc: 10 })]);
    expect(matching()).toEqual(['v0', 'v2', 'v4']);
  });
});
