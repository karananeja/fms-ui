// @vitest-environment node
import { COMBINFO_LEAVE_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FilterEngine } from './filter-engine.ts';
import { FleetState, type FleetStateHooks } from './fleet-state.ts';
import { SearchIndex } from './search-index.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';

const rows = (ns: number[], over: Record<string, unknown> = {}) =>
  ns.map((n) => snapshotRow(n, over));

function recorder(name: string, log: string[]): FleetStateHooks {
  return {
    rowChanged: (i) => log.push(`${name}:row:${i}`),
    beforeRemove: (i) => log.push(`${name}:remove:${i}`),
  };
}

describe('D-065: fleet-state listeners', () => {
  it('calls every listener, in registration order, after the constructor hooks', () => {
    const log: string[] = [];
    const s = new FleetState({ pids: [], hooks: recorder('opts', log) });
    s.addHooks(recorder('a', log));
    s.addHooks(recorder('b', log));
    s.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0]));
    s.applyCombinfo(COMBINFO_LEAVE_FIELDS, [['v0', null]]);
    expect(log).toEqual([
      'opts:row:0',
      'a:row:0',
      'b:row:0',
      'opts:remove:0',
      'a:remove:0',
      'b:remove:0',
    ]);
  });

  it('keeps status counts, filter matches and search correct whatever the construction order', () => {
    // No growth here: filtering across capacity growth is covered separately (F08-T1).
    const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: 16 });
    // Subscribers built *before* the status tracker — previously the tracker overwrote them.
    const filters = new FilterEngine(state);
    const search = new SearchIndex(state);
    const tracker = new StatusTracker(state, statusRulesConfig);
    tracker.now = BASE_T;

    filters.set({ fleetIds: ['f0'] });
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0, 1, 2, 3, 4, 5]));
    state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [['v2', null]]);

    const total = Object.values(tracker.statusCounts()).reduce((a, b) => a + b, 0);
    expect(total).toBe(5);
    for (let i = 0; i < state.count; i++)
      expect(VEHICLE_STATUSES).toContain(tracker.statusOf(i));
    const matched = state.str.vehicleId.filter((_, i) => filters.matches(i)).sort();
    expect(matched).toEqual(['v0', 'v4']);
    expect(search.suggest('ka01ab000', 'regno').map((s) => s.vehicleId).sort()).toEqual(
      ['v0', 'v1', 'v3', 'v4', 'v5'],
    );
  });
});

describe('F08 search-index invalidation', () => {
  it('re-indexes when a vehicle identifier changes', () => {
    const state = new FleetState({ pids: [] });
    const search = new SearchIndex(state);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0, 1]));
    expect(search.suggest('KA01AB0001', 'regno').map((s) => s.vehicleId)).toEqual(['v1']);

    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(1, { regno: 'MH12ZZ9999' })]);
    expect(search.suggest('KA01AB0001', 'regno')).toEqual([]);
    expect(search.suggest('mh12', 'regno').map((s) => s.vehicleId)).toEqual(['v1']);
  });

  it('does not rebuild on rows that leave identifiers unchanged', () => {
    const state = new FleetState({ pids: [] });
    const search = new SearchIndex(state);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0, 1]));
    search.suggest('KA', 'all');
    const built = search.buildMs;
    search.buildMs = -1;
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0, 1], { speed: 42 }));
    search.suggest('KA', 'all');
    expect(search.buildMs).toBe(-1);
    expect(built).toBeGreaterThanOrEqual(0);
  });

  it('picks up added and removed vehicles', () => {
    const state = new FleetState({ pids: [] });
    const search = new SearchIndex(state);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([0, 1]));
    expect(search.suggest('VIN', 'vin')).toHaveLength(2);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows([2]));
    expect(search.suggest('VIN', 'vin')).toHaveLength(3);
    state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [['v0', null]]);
    expect(search.suggest('VIN', 'vin').map((s) => s.vehicleId).sort()).toEqual(['v1', 'v2']);
  });
});
