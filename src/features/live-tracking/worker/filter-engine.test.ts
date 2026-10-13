// @vitest-environment node
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { FilterEngine } from './filter-engine.ts';
import { FleetState } from './fleet-state.ts';
import { snapshotRow } from './testing/fake-socket.ts';

const matching = (state: FleetState, filters: FilterEngine) =>
  state.str.vehicleId.filter((_, i) => filters.matches(i)).sort();

describe('F08-T1: filter-engine', () => {
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
    expect(matching(state, filters)).toEqual(['v0', 'v2', 'v4', 'v6']);

    // An update after growth is re-checked against the live columns too.
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(6, { soc: 10 })]);
    expect(matching(state, filters)).toEqual(['v0', 'v2', 'v4']);
  });
});
