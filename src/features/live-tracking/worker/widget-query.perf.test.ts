// @vitest-environment node
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FleetState } from './fleet-state.ts';
import { StatusTracker } from './status-deriver.ts';
import { TableQueryEngine } from './table-query.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';
import { WidgetQueryEngine, type LiveWidgetQuery } from './widget-query.ts';

const VEHICLES = 100_000;
const FLEETS = Array.from({ length: 40 }, (_, k) => ({
  id: `f${k}`,
  parentId: k < 4 ? null : `f${k % 4}`,
}));

const QUERIES: LiveWidgetQuery[] = [
  { kind: 'counts' },
  { kind: 'counts', fleetId: 'f1' },
  {
    kind: 'list',
    filter: { statuses: ['running'] },
    sort: { column: 'speed', dir: 'desc' },
    limit: 10,
  },
  { kind: 'list', filter: { fleetIds: ['f2'] }, sort: { column: 'regno', dir: 'asc' }, limit: 50 },
  {
    kind: 'list',
    filter: { socMax: 20, fuelTypes: ['Electric'] },
    sort: { column: 'soc', dir: 'asc' },
    limit: 20,
  },
  { kind: 'list', filter: {}, sort: { column: 'odometer', dir: 'desc' }, limit: 10 },
];

describe('F20-T4 perf: queryWidgets at 1 lakh vehicles', () => {
  it('6 live queries ≤ 10 ms p95; unchanged version ≤ 0.1 ms', { timeout: 30_000 }, () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: VEHICLES });
    const status = new StatusTracker(state, statusRulesConfig);
    status.now = BASE_T;
    state.applyCombinfo(
      COMBINFO_SNAPSHOT_FIELDS,
      Array.from({ length: VEHICLES }, (_, i) =>
        snapshotRow(i, {
          fleetId: `f${i % 40}`,
          fuelType: i % 5 ? 'Electric' : 'CNG',
          soc: Math.floor(rnd() * 101),
          speed: i % 3 ? 0 : Math.floor(rnd() * 80),
          odometer: Math.floor(rnd() * 1e6),
          regno: `KA${String(i % 99).padStart(2, '0')}AB${String(i % 10_000).padStart(4, '0')}`,
        }),
      ),
    );
    const table = new TableQueryEngine(
      state,
      () => true,
      () => state.version,
      () => 0,
    );
    let version = 0;
    const engine = new WidgetQueryEngine({
      state,
      dataVersion: () => version,
      ready: () => true,
      statusCounts: () => status.statusCounts(),
      fleetNames: () => ({}),
      row: (i) => table.row(i),
    });
    engine.setFleets(FLEETS);
    const times: number[] = [];
    for (let k = 0; k < 20; k++) {
      version++;
      const t0 = performance.now();
      engine.query(QUERIES);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) engine.query(QUERIES, version);
    const unchanged = (performance.now() - t0) / 100;
    console.info(`[F20-T4 perf] p95 ${p95.toFixed(2)} ms, unchanged ${unchanged.toFixed(4)} ms`);
    expect(p95).toBeLessThanOrEqual(10);
    expect(unchanged).toBeLessThanOrEqual(0.1);

    // F26-T4: three custom queries (map points, grouped aggregate, top-10 rows) ≤ 15 ms p95.
    const CUSTOM: LiveWidgetQuery[] = [
      {
        kind: 'custom',
        filter: { all: [{ field: 'soc', op: 'lt', value: 20 }] },
        points: { color: 'status', max: 2000 },
      },
      { kind: 'custom', shape: { groupBy: 'fleet', aggregate: { op: 'avg', field: 'soc' } } },
      {
        kind: 'custom',
        filter: { all: [{ field: 'status', op: 'eq', value: 'running' }] },
        shape: { sort: { by: 'speed', dir: 'desc' }, limit: 10 },
        columns: ['regno', 'fleet', 'speed', 'soc'],
      },
    ];
    const custom: number[] = [];
    for (let k = 0; k < 20; k++) {
      version++;
      const t0 = performance.now();
      engine.query(CUSTOM);
      custom.push(performance.now() - t0);
    }
    custom.sort((a, b) => a - b);
    const cp95 = custom[Math.ceil(custom.length * 0.95) - 1]!;
    console.info(`[F26-T4 perf] custom p95 ${cp95.toFixed(2)} ms`);
    expect(cp95).toBeLessThanOrEqual(15);
  });
});
