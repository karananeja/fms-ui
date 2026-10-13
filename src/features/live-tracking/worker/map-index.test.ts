// @vitest-environment node
import type { Me } from '@shared/contract/index.ts';
import { COMBINFO_DELTA_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FleetState } from './fleet-state.ts';
import { LiveTrackingEngine, SUB_FLEET_COMBINFO } from './live-tracking-engine.ts';
import { MapIndex } from './map-index.ts';
import { STATUS_CODE, StatusTracker } from './status-deriver.ts';
import { BASE_T, deltaRow, fakeSockets, snapshotRow } from './testing/fake-socket.ts';
import type { Bbox, MapFrame, LivePush } from './worker-api.ts';

const INDIA: Bbox = [68.1, 6.5, 97.4, 35.7];
const CENTRES: [number, number][] = [
  [77.59, 12.97],
  [72.88, 19.08],
  [77.21, 28.61],
  [88.36, 22.57],
  [73.86, 18.52],
];

/** Deterministic synthetic fleet: `n` vehicles around 5 cities, every 50th has no fix. */
function fleet(n: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig) });
  const status = new StatusTracker(state, statusRulesConfig);
  const rows = Array.from({ length: n }, (_, i) => {
    const [lng, lat] = CENTRES[i % CENTRES.length]!;
    const gpsNever = i % 50 === 0;
    return snapshotRow(i, {
      lat: gpsNever ? 0 : lat + (rnd() - 0.5) * 0.3,
      lng: gpsNever ? 0 : lng + (rnd() - 0.5) * 0.3,
      heading: rnd() * 360,
      speed: i % 3 ? 0 : 20,
      utctime: BASE_T,
      gpstime: BASE_T,
    });
  });
  status.now = BASE_T;
  state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows);
  const valid = n - Math.ceil(n / 50);
  return { state, status, valid };
}

const sum = (a: ArrayLike<number>) => Array.prototype.reduce.call(a, (x, y) => x + y, 0) as number;
const inBox = ([w, s, e, n]: Bbox, lng: number, lat: number) =>
  lng >= w && lng <= e && lat >= s && lat <= n;

describe('F06-T1: map-index frames', () => {
  it('zoom 4 over India: clusters + points add up to every vehicle with a fix', () => {
    const { state, valid } = fleet(5000);
    const index = new MapIndex(state);
    index.update(state.version, 0);
    const f = index.frame({ bbox: INDIA, zoom: 4 });
    expect(f.clusters.count.length).toBeGreaterThan(0);
    expect(sum(f.clusters.count) + f.points.ids.length).toBe(valid);
  });

  it("each cluster's status breakdown adds up to its count", () => {
    const { state } = fleet(5000);
    const index = new MapIndex(state);
    for (const zoom of [3, 6, 9]) {
      const { clusters } = index.frame({ bbox: INDIA, zoom });
      for (let k = 0; k < clusters.count.length; k++) {
        expect(sum(clusters.breakdown.subarray(k * 8, k * 8 + 8))).toBe(clusters.count[k]);
      }
      const gpsNever = STATUS_CODE['gps-never'] - 1;
      expect(sum(clusters.breakdown.filter((_, j) => j % 8 === gpsNever))).toBe(0);
    }
  });

  it('zoom ≥ 15 scans live state and returns only points inside the box', () => {
    const { state } = fleet(5000);
    const index = new MapIndex(state);
    const bbox: Bbox = [77.58, 12.96, 77.62, 12.99];
    const f = index.frame({ bbox, zoom: 15.4 });
    expect(f.clusters.count.length).toBe(0);
    const { lat, lng } = state.cols;
    let expected = 0;
    for (let i = 0; i < state.count; i++) if (inBox(bbox, lng[i]!, lat[i]!)) expected++;
    expect(expected).toBeGreaterThan(0);
    expect(f.points.ids.length).toBe(expected);
    for (let k = 0; k < f.points.ids.length; k++) {
      expect(inBox(bbox, f.points.lng[k]!, f.points.lat[k]!)).toBe(true);
    }
    expect(f.points.regnos[0]).toMatch(/^KA01AB/);
  });

  it('the maxFramePoints cap forces clustering', () => {
    const { state } = fleet(5000);
    const index = new MapIndex(state, { maxFramePoints: 50 });
    const bbox: Bbox = [77.4, 12.8, 77.8, 13.2];
    const f = index.frame({ bbox, zoom: 16 });
    expect(f.points.ids.length).toBeLessThanOrEqual(50);
    expect(f.clusters.count.length).toBeGreaterThan(0);
  });
});

describe('F06-T2: rebuild throttle and live close-ups', () => {
  it('rebuilds at most once per clusterRebuildMs, only after a change', () => {
    const { state } = fleet(500);
    const index = new MapIndex(state, { clusterRebuildMs: 2000 });
    expect(index.update(1, 0)).toBe(true);
    expect(index.update(2, 1000)).toBe(false);
    expect(index.rebuildWait(2, 1000)).toBe(1000);
    expect(index.update(2, 1999)).toBe(false);
    expect(index.update(2, 2000)).toBe(true);
    expect(index.update(2, 9000)).toBe(false);
    expect(index.rebuildWait(2, 9000)).toBeNull();
    expect(index.builds).toBe(2);
  });

  it('force skips the throttle (first complete snapshot), but not an unchanged version', () => {
    const { state } = fleet(500);
    const index = new MapIndex(state, { clusterRebuildMs: 2000 });
    index.update(1, 0);
    expect(index.update(2, 100, true)).toBe(true);
    expect(index.update(2, 200, true)).toBe(false);
  });

  it('a position update shows up in a zoom-15 frame without a rebuild', () => {
    const { state } = fleet(500);
    const index = new MapIndex(state);
    index.update(state.version, 0);
    const bbox: Bbox = [80, 10, 80.01, 10.01];
    expect(index.frame({ bbox, zoom: 15 }).points.ids).toEqual([]);
    state.applyCombinfo(COMBINFO_DELTA_FIELDS, [
      deltaRow(1, { lat: 10.005, lng: 80.005, utctime: BASE_T + 1 }),
    ]);
    const f = index.frame({ bbox, zoom: 15 });
    expect(f.points.ids).toEqual(['v1']);
    expect(index.builds).toBe(1);
  });

  describe('engine', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('pushes fresh frames within the push cadence and rebuilds ≤ 1 per 2 s', () => {
      const s = fakeSockets();
      const pushes: LivePush[] = [];
      const engine = new LiveTrackingEngine({
        url: 'ws://test',
        createSocket: s.create,
        random: () => 1,
      });
      engine.init({ fleetIds: ['f0'] } as unknown as Me, (p) => pushes.push(p));
      s.last().open();
      s.last().message({
        type: 'snapshot',
        id: SUB_FLEET_COMBINFO,
        seq: 1,
        chunk: 0,
        chunks: 1,
        fields: COMBINFO_SNAPSHOT_FIELDS,
        rows: Array.from({ length: 200 }, (_, n) => snapshotRow(n)),
      });
      const first = engine.setViewport({ bbox: INDIA, zoom: 5 })!;
      expect(engine.map.builds).toBe(1);
      const builds: number[] = [];
      for (let k = 1; k <= 60; k++) {
        vi.advanceTimersByTime(100);
        s.last().message({
          type: 'delta',
          id: SUB_FLEET_COMBINFO,
          seq: k + 1,
          fields: COMBINFO_DELTA_FIELDS,
          rows: [deltaRow(k, { utctime: BASE_T + k })],
        });
        builds.push(engine.map.builds);
      }
      // 6 s of changes: rebuilds at ~2, 4, 6 s.
      expect(engine.map.builds - 1).toBeGreaterThanOrEqual(2);
      expect(engine.map.builds - 1).toBeLessThanOrEqual(3);
      const frames = pushes.map((p) => p.mapFrame).filter(Boolean) as MapFrame[];
      expect(frames.length).toBeGreaterThanOrEqual(20);
      expect(frames.length).toBeLessThanOrEqual(25);
      expect(frames[0]!.version).toBeGreaterThan(first.version);
      // Fake timers freeze performance.now(), so only the plumbing is checked here (T5 measures).
      expect(pushes.at(-1)!.stats.clusterBuildMs).toBe(engine.map.buildMs);
      engine.setViewport(null);
      const n = pushes.length;
      s.last().message({
        type: 'delta',
        id: SUB_FLEET_COMBINFO,
        seq: 99,
        fields: COMBINFO_DELTA_FIELDS,
        rows: [deltaRow(1, { utctime: BASE_T + 99 })],
      });
      vi.advanceTimersByTime(500);
      expect(pushes.slice(n).some((p) => p.mapFrame)).toBe(false);
      engine.dispose();
    });
  });
});

describe('F06-T3: bounds and expansion zoom', () => {
  it('getBounds leaves out gps-never and is null when empty', () => {
    const { state } = fleet(500);
    const [w, s, e, n] = new MapIndex(state).bounds()!;
    expect(w).toBeGreaterThan(72);
    expect(s).toBeGreaterThan(12);
    expect(e).toBeLessThan(89);
    expect(n).toBeLessThan(29);
    expect(new MapIndex(fleet(0).state).bounds()).toBeNull();
    const onlyNever = new FleetState({ pids: [] });
    onlyNever.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(1, { lat: 0, lng: 0 })]);
    expect(new MapIndex(onlyNever).bounds()).toBeNull();
  });

  it('getClusterExpansionZoom is greater than the current zoom; stale ids give null', () => {
    const { state } = fleet(2000);
    const index = new MapIndex(state);
    const zoom = 5;
    const { clusters } = index.frame({ bbox: INDIA, zoom });
    expect(clusters.id.length).toBeGreaterThan(0);
    for (const id of clusters.id) expect(index.expansionZoom(id)).toBeGreaterThan(zoom);
    expect(index.expansionZoom(123_456_789)).toBeNull();
  });
});

describe('frame transfer', () => {
  it('every typed array has its own buffer', async () => {
    const { frameBuffers } = await import('./map-index.ts');
    const { state } = fleet(200);
    const buffers = frameBuffers(new MapIndex(state).frame({ bbox: INDIA, zoom: 6 }));
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});
