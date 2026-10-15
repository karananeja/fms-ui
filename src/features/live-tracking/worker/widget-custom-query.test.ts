// @vitest-environment node
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FleetState } from './fleet-state.ts';
import { StatusTracker } from './status-deriver.ts';
import { TableQueryEngine } from './table-query.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';
import { WidgetQueryEngine, type LiveCustomResult } from './widget-query.ts';

const FLEETS = [
  { id: 'root', parentId: null },
  { id: 'f0', parentId: 'root' },
  { id: 'f1', parentId: 'root' },
  { id: 'f0a', parentId: 'f0' },
];

function setup() {
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: 64 });
  const status = new StatusTracker(state, statusRulesConfig);
  status.now = BASE_T;
  const fleet = ['f0', 'f1', 'f0a'];
  state.applyCombinfo(
    COMBINFO_SNAPSHOT_FIELDS,
    Array.from({ length: 30 }, (_, i) =>
      snapshotRow(i, {
        fleetId: fleet[i % 3],
        soc: i * 3,
        speed: i % 2 ? 0 : i,
        make: i % 4 ? 'Tata' : 'Ola',
        ...(i === 29 && { lat: 0, lng: 0 }),
      }),
    ),
  );
  const table = new TableQueryEngine(state, () => true, () => state.version, () => 0);
  let version = 1;
  const engine = new WidgetQueryEngine({
    state,
    dataVersion: () => version,
    ready: () => true,
    statusCounts: () => status.statusCounts(),
    fleetNames: () => ({}),
    row: (i) => table.row(i),
  });
  engine.setFleets(FLEETS);
  return { engine, bump: () => version++ };
}

const one = (engine: WidgetQueryEngine, q: Parameters<WidgetQueryEngine['query']>[0][number]) =>
  engine.query([q]).results![0] as LiveCustomResult;

describe('F26-T3 worker custom queries', () => {
  it('rows: filter (fleet subtree), sort, limit and requested columns', () => {
    const { engine } = setup();
    const r = one(engine, {
      kind: 'custom',
      filter: { all: [{ field: 'fleet', op: 'eq', value: 'f0' }, { field: 'soc', op: 'lt', value: 40 }] },
      shape: { sort: { by: 'soc', dir: 'desc' }, limit: 3 },
      columns: ['soc', 'fleet'],
    });
    // f0 + its child f0a: i % 3 ∈ {0, 2}, soc = 3i < 40 → i ∈ {0, 2, 3, 5, 6, 8, 9, 11, 12}.
    expect(r.total).toBe(9);
    expect(r.rows!.map((x) => x.soc)).toEqual([36, 33, 27]);
    expect(Object.keys(r.rows![0]!).sort()).toEqual(['fleet', 'regno', 'soc', 'vehicleId']);
  });

  it('groups and aggregates by make; a single value', () => {
    const { engine } = setup();
    const g = one(engine, { kind: 'custom', shape: { groupBy: 'make' } });
    expect(g.groups!.map((x) => [x.key, x.value])).toEqual([
      ['Tata', 22],
      ['Ola', 8],
    ]);
    const v = one(engine, { kind: 'custom', shape: { aggregate: { op: 'max', field: 'soc' } } });
    expect(v.value).toBe(87);
  });

  it('points: valid positions only, colour field, cap; follow one regno', () => {
    const { engine } = setup();
    const p = one(engine, {
      kind: 'custom',
      filter: { all: [{ field: 'soc', op: 'gte', value: 60 }] },
      points: { color: 'make', max: 3 },
    });
    // soc ≥ 60 → i 20..29; i = 29 has no position.
    expect(p.total).toBe(9);
    expect(p.points!.ids).toHaveLength(3);
    expect(p.points!.color[0]).toBe('Ola');
    const f = one(engine, {
      kind: 'custom',
      filter: { all: [{ field: 'regno', op: 'eq', value: 'ka01ab0007' }] },
      points: { max: 1 },
    });
    expect(f.points!.regnos).toEqual(['KA01AB0007']);
    expect(f.points!.lat[0]).toBeCloseTo(12.007);
  });

  it('cached per data version; unchanged version answers null', () => {
    const { engine, bump } = setup();
    const q = { kind: 'custom' as const, shape: { groupBy: 'fleet' } };
    engine.query([q]);
    const scans = engine.scans;
    engine.query([q]);
    expect(engine.scans).toBe(scans);
    expect(engine.query([q], 1).results).toBeNull();
    bump();
    engine.query([q]);
    expect(engine.scans).toBe(scans + 1);
  });
});
