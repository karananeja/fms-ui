// @vitest-environment node
import type { Me } from '@shared/contract/index.ts';
import { COMBINFO_DELTA_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FilterEngine } from './filter-engine.ts';
import { FleetState } from './fleet-state.ts';
import { LiveTrackingEngine, SUB_FLEET_COMBINFO } from './live-tracking-engine.ts';
import { MapIndex } from './map-index.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, deltaRow, fakeSockets, snapshotRow } from './testing/fake-socket.ts';
import type { Bbox, LivePush, MapFrame } from './worker-api.ts';

const INDIA: Bbox = [68.1, 6.5, 97.4, 35.7];
const sum = (a: ArrayLike<number>) => Array.prototype.reduce.call(a, (x, y) => x + y, 0) as number;

/** `n` vehicles around Bengaluru; fleet f0 = even ids, f1 = odd ids. Every 10th has no fix. */
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    snapshotRow(i, {
      fleetId: `f${i % 2}`,
      lat: i % 10 === 0 ? 0 : 12.9 + (i % 37) / 400,
      lng: i % 10 === 0 ? 0 : 77.5 + (i % 41) / 400,
      utctime: BASE_T,
      gpstime: BASE_T,
    }),
  );

function setup(n: number) {
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig) });
  const status = new StatusTracker(state, statusRulesConfig);
  status.now = BASE_T;
  const filters = new FilterEngine(state);
  const index = new MapIndex(state, {}, filters);
  state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows(n));
  return { state, filters, index };
}

const frameIds = (f: MapFrame) => [...f.points.ids];

describe('F08-T4: map-index honours the filter', () => {
  it('clusters and points only count matching vehicles', () => {
    const { state, filters, index } = setup(400);
    index.update(state.version, 0);
    const all = index.frame({ bbox: INDIA, zoom: 4 });
    expect(sum(all.clusters.count) + all.points.ids.length).toBe(360);

    filters.set({ fleetIds: ['f1'] }); // odd ids, none of them is a multiple of 10
    index.update(state.version + filters.baseVersion, 1, true);
    const f1 = index.frame({ bbox: INDIA, zoom: 4 });
    expect(sum(f1.clusters.count) + f1.points.ids.length).toBe(200);
    for (const id of frameIds(f1)) expect(Number(id.slice(1)) % 2).toBe(1);
  });

  it('the zoom-15+ live scan skips non-matching vehicles', () => {
    const { state, filters, index } = setup(400);
    filters.set({ fleetIds: ['f0'] });
    index.update(state.version + filters.baseVersion, 0, true);
    const f = index.frame({ bbox: [77.4, 12.8, 77.7, 13.1], zoom: 16 });
    expect(f.clusters.count.length).toBe(0);
    expect(f.points.ids.length).toBe(160); // even ids with a fix: 200 − 40
    for (const id of frameIds(f)) expect(Number(id.slice(1)) % 2).toBe(0);
  });

  it('bounds fit the filtered set; null when nothing matches', () => {
    const { filters, index } = setup(400);
    filters.set({ search: { field: 'vin', prefix: 'VIN11' } }); // 11, 110…119
    // v110 has no fix; the rest sit at (i % 37, i % 41) offsets.
    const ids = [11, 111, 112, 113, 114, 115, 116, 117, 118, 119];
    const lats = ids.map((i) => 12.9 + (i % 37) / 400);
    const lngs = ids.map((i) => 77.5 + (i % 41) / 400);
    const [w, s, e, n] = index.bounds()!;
    expect(w).toBeCloseTo(Math.min(...lngs));
    expect(e).toBeCloseTo(Math.max(...lngs));
    expect(s).toBeCloseTo(Math.min(...lats));
    expect(n).toBeCloseTo(Math.max(...lats));
    filters.set({ search: { field: 'vin', prefix: 'NOPE' } });
    expect(index.bounds()).toBeNull();
  });
});

describe('F08: engine filter plumbing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function engine() {
    const s = fakeSockets();
    const pushes: LivePush[] = [];
    const e = new LiveTrackingEngine({ url: 'ws://test', createSocket: s.create, random: () => 1 });
    e.init({ fleetIds: ['f0', 'f1'] } as unknown as Me, (p) => pushes.push(p));
    s.last().open();
    s.last().message({
      type: 'snapshot',
      id: SUB_FLEET_COMBINFO,
      seq: 1,
      chunk: 0,
      chunks: 1,
      fields: COMBINFO_SNAPSHOT_FIELDS,
      rows: rows(200),
    });
    return { e, pushes, s };
  }

  it('a filter change rebuilds at once (no throttle) and the next push carries filtered counts', () => {
    const { e, pushes } = engine();
    e.setViewport({ bbox: INDIA, zoom: 5 });
    vi.advanceTimersByTime(300);
    const builds = e.map.builds;
    const before = pushes.at(-1)!;
    expect(before.filteredTotal).toBe(200);
    expect(before.filteredCounts).toEqual(before.statusCounts);

    e.setFilter({ fleetIds: ['f1'] });
    vi.advanceTimersByTime(300); // well inside clusterRebuildMs (2 s)
    expect(e.map.builds).toBe(builds + 1);
    const after = pushes.at(-1)!;
    expect(after.filteredTotal).toBe(100);
    expect(after.total).toBe(200); // unfiltered F05 counts unchanged
    const frame = pushes
      .map((p) => p.mapFrame)
      .filter(Boolean)
      .at(-1)!;
    expect(sum(frame.clusters.count) + frame.points.ids.length).toBe(100);

    e.setFilter({});
    vi.advanceTimersByTime(300);
    expect(pushes.at(-1)!.filteredTotal).toBe(200);
    e.dispose();
  });

  it('a status-only change pushes a new frame without a rebuild; Clear all reuses the cached index (D-072)', () => {
    const { e, pushes } = engine();
    e.setViewport({ bbox: INDIA, zoom: 5 });
    vi.advanceTimersByTime(300);
    const builds = e.map.builds;
    const lastFrame = () =>
      pushes
        .map((p) => p.mapFrame)
        .filter(Boolean)
        .at(-1)!;

    // The commonest status that has a fix (gps-never vehicles are never on the map).
    const counts = pushes.at(-1)!.filteredCounts;
    const [top, n] = Object.entries(counts)
      .filter(([s]) => s !== 'gps-never')
      .sort((a, b) => b[1] - a[1])[0]! as [VehicleStatus, number];
    expect(n).toBeGreaterThan(0);
    e.setFilter({ statuses: [top] });
    vi.advanceTimersByTime(300);
    expect(e.map.builds).toBe(builds);
    expect(pushes.at(-1)!.filteredTotal).toBe(n);
    expect(sum(lastFrame().clusters.count) + lastFrame().points.ids.length).toBe(n);

    e.setFilter({ fleetIds: ['f1'], statuses: ['stopped'] });
    vi.advanceTimersByTime(300);
    expect(e.map.builds).toBe(builds + 1);

    e.setFilter({});
    vi.advanceTimersByTime(300);
    expect(e.map.cacheHits).toBe(1);
    expect(e.map.builds).toBe(builds + 2); // the fresh rebuild ran right after the swap
    expect(sum(lastFrame().clusters.count) + lastFrame().points.ids.length).toBe(180);
    e.dispose();
  });

  it('D-073: a filter change pushes at once and restarts the push window; data alone stays at 4 Hz', () => {
    const { e, pushes, s } = engine();
    e.setViewport({ bbox: INDIA, zoom: 5 });
    vi.advanceTimersByTime(1000);
    let seq = 1;
    const data = () =>
      s.last().message({
        type: 'delta',
        id: SUB_FLEET_COMBINFO,
        seq: ++seq,
        fields: COMBINFO_DELTA_FIELDS,
        rows: [deltaRow(3, { utctime: BASE_T + seq, speed: seq % 50 })],
      });
    const n0 = pushes.length;

    // Data change: coalesced into the next slot, not pushed synchronously.
    data();
    expect(pushes.length).toBe(n0);
    vi.advanceTimersByTime(250);
    expect(pushes.length).toBe(n0 + 1);

    // 100 ms into the window: the filter change pushes immediately, with its frame.
    vi.advanceTimersByTime(100);
    data(); // pending data rides along in the filter push
    e.setFilter({ fleetIds: ['f1'] });
    expect(pushes.length).toBe(n0 + 2);
    expect(pushes.at(-1)!.filteredTotal).toBe(100);
    expect(pushes.at(-1)!.mapFrame).toBeTruthy();
    vi.advanceTimersByTime(150); // the cancelled slot does not push again
    expect(pushes.length).toBe(n0 + 2);

    // The window restarted at the filter push: data waits a full 250 ms from it.
    data();
    vi.advanceTimersByTime(99);
    expect(pushes.length).toBe(n0 + 2);
    vi.advanceTimersByTime(1);
    expect(pushes.length).toBe(n0 + 3);

    // Data alone never exceeds 4 Hz.
    const t0 = pushes.length;
    for (let k = 0; k < 100; k++) {
      data();
      vi.advanceTimersByTime(10);
    }
    expect(pushes.length - t0).toBeLessThanOrEqual(4);
    e.dispose();
  });

  it('reports when the selected vehicle is hidden by the filter (F08-R13)', () => {
    const { e, pushes } = engine();
    expect(e.selectVehicle('v2')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(pushes.at(-1)!.selectedMatches).toBe(true);
    e.setFilter({ fleetIds: ['f1'] });
    vi.advanceTimersByTime(300);
    expect(pushes.at(-1)!.selectedMatches).toBe(false);
    e.dispose();
  });

  it('filter options list distinct values present in the fleet; models carry their make', () => {
    const { e } = engine();
    expect(e.getFilterOptions()).toEqual({
      assetTypes: ['Bus'],
      fuelTypes: ['Electric'],
      makes: ['Make'],
      models: [{ make: 'Make', model: 'Model' }],
    });
    e.dispose();
  });
});

/** Like `rows`, with statuses mixed by `i % 3`: running, ignition on & stopped, ignition off. */
const mixedRows = (n: number) =>
  rows(n).map((r, i) => {
    const out = [...r];
    const k = i % 3;
    out[COMBINFO_SNAPSHOT_FIELDS.indexOf('speed')] = k === 0 ? 10 : 0;
    out[COMBINFO_SNAPSHOT_FIELDS.indexOf('ignstatus')] = k === 2 ? 0 : 1;
    return out;
  });

describe('D-072: status selection per frame, cached unfiltered index', () => {
  function mixed(n: number) {
    const state = new FleetState({ pids: statusLafPids(statusRulesConfig) });
    const status = new StatusTracker(state, statusRulesConfig);
    status.now = BASE_T;
    const filters = new FilterEngine(state);
    const index = new MapIndex(state, {}, filters);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, mixedRows(n));
    const v = () => state.version + filters.baseVersion;
    return { state, filters, index, v };
  }

  const total = (f: MapFrame) => sum(f.clusters.count) + f.points.ids.length;
  const RUNNING = 1 << (VEHICLE_STATUSES.indexOf('running') + 1);

  it('a status-only change keeps the index; clusters count only the selected statuses', () => {
    const { state, filters, index, v } = mixed(400);
    index.update(v(), 0);
    expect(total(index.frame({ bbox: INDIA, zoom: 4 }))).toBe(360);
    const builds = index.builds;
    const baseVersion = filters.baseVersion;

    filters.set({ statuses: ['running'] });
    expect(filters.baseVersion).toBe(baseVersion);
    expect(index.update(v(), 1, true)).toBe(false);
    expect(index.builds).toBe(builds);
    const f = index.frame({ bbox: INDIA, zoom: 4 });
    expect(total(f)).toBe(filters.matchCount); // 120 running, all with a fix
    expect(total(f)).toBe(120);
    for (let k = 0; k < f.clusters.count.length; k++) {
      const b = f.clusters.breakdown.subarray(k * 8, k * 8 + 8);
      expect(f.clusters.count[k]).toBeGreaterThan(0); // empty clusters dropped
      expect(sum(b)).toBe(f.clusters.count[k]);
      b.forEach((c, j) => j !== VEHICLE_STATUSES.indexOf('running') && expect(c).toBe(0));
    }
    for (const id of frameIds(f)) expect(filters.matches(state.indexOf(id))).toBe(true);
    expect(filters.statusMask).toBe(RUNNING);

    // Zoom-16 point scan honours statuses too.
    const z16 = index.frame({ bbox: [77.4, 12.8, 77.7, 13.1], zoom: 16 });
    expect(z16.clusters.count.length).toBe(0);
    expect(z16.points.ids.length).toBe(120);
    expect([...z16.points.status].every((s) => RUNNING & (1 << s))).toBe(true);

    filters.set({ statuses: ['immobilized'] }); // nothing matches: every cluster dropped
    const none = index.frame({ bbox: INDIA, zoom: 4 });
    expect(none.clusters.count.length + none.points.ids.length).toBe(0);
    expect(index.bounds()).toBeNull();
  });

  it('back to no non-status filter: serves the cached unfiltered index, rebuilds right after', () => {
    const { filters, index, v } = mixed(400);
    index.update(v(), 0);
    filters.set({ fleetIds: ['f1'], statuses: ['stopped'] });
    expect(index.update(v(), 10, true)).toBe(true);
    expect(index.builds).toBe(2);
    expect(total(index.frame({ bbox: INDIA, zoom: 4 }))).toBe(filters.matchCount);

    filters.set({ statuses: ['stopped'] }); // fleet removed, status kept
    const generation = index.generation;
    expect(index.update(v(), 20, true)).toBe(true);
    expect(index.builds).toBe(2); // no build: cache swap
    expect(index.cacheHits).toBe(1);
    expect(index.generation).toBe(generation + 1);
    expect(total(index.frame({ bbox: INDIA, zoom: 4 }))).toBe(filters.matchCount);
    expect(index.rebuildWait(v(), 20)).toBe(0); // fresh rebuild is due at once
    expect(index.update(v(), 21)).toBe(true);
    expect(index.builds).toBe(3);
    expect(index.rebuildWait(v(), 21)).toBeNull();

    filters.set({});
    expect(total(index.frame({ bbox: INDIA, zoom: 4 }))).toBe(360);
  });

  it('a forced update with no filter excursion still rebuilds (D-063 snapshot complete)', () => {
    const { state, index, v } = mixed(200);
    index.update(v(), 0);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, mixedRows(400));
    expect(index.update(v(), 1, true)).toBe(true);
    expect(index.builds).toBe(2);
    expect(index.cacheHits).toBe(0);
    expect(total(index.frame({ bbox: INDIA, zoom: 4 }))).toBe(360);
  });
});
