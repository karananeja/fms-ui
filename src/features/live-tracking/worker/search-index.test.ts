// @vitest-environment node
import { COMBINFO_LEAVE_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FleetState } from './fleet-state.ts';
import { SearchIndex } from './search-index.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';

/** Vehicles with hand-picked identifiers (index n → v{n}). */
const VEHICLES = [
  { regno: 'KA01AB0001', vin: 'MAT100', deviceId: 'D-900' },
  { regno: 'KA01AB0002', vin: 'MAT200', deviceId: 'D-KA01' },
  { regno: 'MH12CD0003', vin: 'KA01VIN', deviceId: 'D-100' },
  { regno: 'ka01zz0004', vin: 'MAT300', deviceId: 'D-200' },
  { regno: 'DL01AA0005', vin: 'MAT400', deviceId: 'KA01-DEV' },
];

function setup() {
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig) });
  const tracker = new StatusTracker(state, statusRulesConfig);
  tracker.now = BASE_T;
  const search = new SearchIndex(state);
  state.applyCombinfo(
    COMBINFO_SNAPSHOT_FIELDS,
    VEHICLES.map((v, n) => snapshotRow(n, { ...v, speed: n === 0 ? 20 : 0 })),
  );
  const ids = (...args: Parameters<SearchIndex['suggest']>) =>
    search.suggest(...args).map((s) => `${s.vehicleId}:${s.matchedField}`);
  return { state, search, ids };
}

describe('F08-T2: search-index', () => {
  it('prefix-matches each field, case-insensitively', () => {
    const { ids } = setup();
    expect(ids('ka01', 'regno')).toEqual(['v0:regno', 'v1:regno', 'v3:regno']);
    expect(ids('Ka01v', 'vin')).toEqual(['v2:vin']);
    expect(ids('d-1', 'deviceId')).toEqual(['v2:deviceId']);
    expect(ids('nothing', 'all')).toEqual([]);
    expect(ids('   ', 'all')).toEqual([]);
  });

  it('"all" orders by matched field (regno, vin, device) then value, one row per vehicle', () => {
    const { ids } = setup();
    expect(ids('ka01', 'all')).toEqual([
      'v0:regno',
      'v1:regno',
      'v3:regno',
      'v2:vin',
      'v4:deviceId',
    ]);
    // v1's device id `D-KA01` does not start with the prefix; a vehicle is listed once only.
    expect(ids('mat', 'all')).toEqual(['v0:vin', 'v1:vin', 'v3:vin', 'v4:vin']);
  });

  it('respects the limit', () => {
    const { ids } = setup();
    expect(ids('ka01', 'all', 2)).toEqual(['v0:regno', 'v1:regno']);
    expect(ids('ka01', 'all', 0)).toEqual([]);
  });

  it('returns identifiers and the live status', () => {
    const { search } = setup();
    expect(search.suggest('KA01AB0001', 'regno')).toEqual([
      {
        vehicleId: 'v0',
        regno: 'KA01AB0001',
        vin: 'MAT100',
        deviceId: 'D-900',
        status: 'running',
        matchedField: 'regno',
      },
    ]);
  });

  it('is correct after inserts and removals', () => {
    const { state, ids } = setup();
    expect(ids('ka01', 'regno')).toHaveLength(3);
    state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(9, { regno: 'KA01AA0009' })]);
    expect(ids('ka01', 'regno')).toEqual(['v9:regno', 'v0:regno', 'v1:regno', 'v3:regno']);
    state.applyCombinfo(COMBINFO_LEAVE_FIELDS, [
      ['v0', null],
      ['v9', null],
    ]);
    expect(ids('ka01', 'regno')).toEqual(['v1:regno', 'v3:regno']);
  });
});
