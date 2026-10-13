// @vitest-environment node
import {
  COMBINFO_DELTA_FIELDS,
  COMBINFO_LEAVE_FIELDS,
  COMBINFO_SNAPSHOT_FIELDS,
  LAFPARSED_BASE_FIELDS,
} from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { FleetState } from './fleet-state.ts';
import { BASE_T, deltaRow, snapshotRow } from './testing/fake-socket.ts';

const PIDS = ['mcu_charge_plug_status', 'charger_status'];
const LAF_FIELDS = [...LAFPARSED_BASE_FIELDS, ...PIDS];
const lafRow = (n: number, t: number, plug: number | null = 1, charger: number | null = 0) => [
  `d${n}`,
  t,
  plug,
  charger,
];

function seeded(n: number, capacity = 4) {
  const s = new FleetState({ pids: PIDS, capacity });
  s.applyCombinfo(
    COMBINFO_SNAPSHOT_FIELDS,
    Array.from({ length: n }, (_, i) => snapshotRow(i)),
  );
  return s;
}

function expectConsistent(s: FleetState) {
  expect(s.byVehicle.size).toBe(s.count);
  expect(s.byDevice.size).toBe(s.count);
  expect(s.str.vehicleId).toHaveLength(s.count);
  for (let i = 0; i < s.count; i++) {
    expect(s.byVehicle.get(s.str.vehicleId[i]!)).toBe(i);
    expect(s.byDevice.get(s.str.deviceId[i]!)).toBe(i);
  }
}

describe('F04-T2: fleet-state', () => {
  it('inserts snapshot rows into typed columns and grows capacity', () => {
    const s = seeded(10, 4);
    expect(s.count).toBe(10);
    expect(s.capacity).toBe(16);
    expect(s.cols.lat).toBeInstanceOf(Float64Array);
    expect(s.cols.speed).toBeInstanceOf(Float32Array);
    expect(s.cols.ignstatus).toBeInstanceOf(Int8Array);
    expect(s.pidCols.charger_status).toBeInstanceOf(Float32Array);
    expectConsistent(s);
    const v7 = s.summary(s.indexOf('v7'));
    expect(v7).toMatchObject({ vehicleId: 'v7', deviceId: 'd7', fleetId: 'f1', lat: 12.007 });
    expect(v7.pids).toEqual({ mcu_charge_plug_status: null, charger_status: null });
  });

  it('dictionary-encodes low-cardinality strings', () => {
    const s = seeded(10);
    expect(s.codes.fleetId).toBeInstanceOf(Uint16Array);
    expect(s.dicts.fleetId.values).toEqual(['f0', 'f1']);
    expect(s.dicts.assetType.values).toEqual(['Bus']);
    expect(s.dicts.fleetId.values[s.codes.fleetId[s.indexOf('v3')]!]).toBe('f1');
  });

  it('updates live fields, drops older rows and increments version', () => {
    const s = seeded(3);
    const v0 = s.version;
    expect(
      s.applyCombinfo(COMBINFO_DELTA_FIELDS, [deltaRow(1, { speed: 55, utctime: BASE_T + 10 })]),
    ).toBe(1);
    expect(s.summary(s.indexOf('v1')).speed).toBe(55);
    expect(s.version).toBe(v0 + 1);
    expect(
      s.applyCombinfo(COMBINFO_DELTA_FIELDS, [deltaRow(1, { speed: 1, utctime: BASE_T + 5 })]),
    ).toBe(0);
    expect(s.summary(s.indexOf('v1')).speed).toBe(55);
    expect(s.version).toBe(v0 + 1);
    // Unknown vehicle in a live-field delta: ignored.
    expect(s.applyCombinfo(COMBINFO_DELTA_FIELDS, [deltaRow(99)])).toBe(0);
    expect(s.count).toBe(3);
  });

  it('a full-field delta (vehicle entered scope) inserts or updates metadata', () => {
    const s = seeded(3);
    s.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(1, { fleetId: 'f9' }), snapshotRow(5)]);
    expect(s.count).toBe(4);
    expect(s.summary(s.indexOf('v1')).fleetId).toBe('f9');
    expectConsistent(s);
  });

  it('fleetId null swap-removes and keeps both maps consistent', () => {
    const s = seeded(6);
    const v0 = s.version;
    s.applyCombinfo(COMBINFO_LEAVE_FIELDS, [
      ['v1', null],
      ['v5', null],
      ['v404', null],
    ]);
    expect(s.count).toBe(4);
    expect(s.version).toBe(v0 + 2);
    expect(s.indexOf('v1')).toBe(-1);
    expect(s.byDevice.has('d5')).toBe(false);
    expectConsistent(s);
    // The moved vehicle kept its data.
    expect(s.summary(s.indexOf('v4')).lat).toBeCloseTo(12.004);
    s.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(1)]);
    expect(s.count).toBe(5);
    expectConsistent(s);
  });

  it('drops lafparsed rows older than the stored lafparsed time', () => {
    const s = seeded(2);
    s.applyLafparsed(LAF_FIELDS, [lafRow(0, BASE_T + 10, 1, 1)]);
    s.applyLafparsed(LAF_FIELDS, [lafRow(0, BASE_T + 5, 0, 0)]);
    expect(s.summary(0).pids).toEqual({ mcu_charge_plug_status: 1, charger_status: 1 });
    s.applyLafparsed(LAF_FIELDS, [lafRow(0, BASE_T + 20, null, 0)]);
    expect(s.summary(0).pids).toEqual({ mcu_charge_plug_status: null, charger_status: 0 });
  });

  it('reconciles: vehicles absent from a completed snapshot are removed, no duplicates', () => {
    const s = seeded(10);
    s.beginSnapshot();
    s.applyCombinfo(
      COMBINFO_SNAPSHOT_FIELDS,
      [0, 2, 4, 6, 8, 11].map((n) => snapshotRow(n)),
    );
    expect(s.count).toBe(11);
    expect(s.endSnapshot()).toBe(5);
    expect([...s.str.vehicleId].sort()).toEqual(['v0', 'v11', 'v2', 'v4', 'v6', 'v8']);
    expectConsistent(s);
  });

  it('reports state bytes that grow with the fleet', () => {
    const small = seeded(10).bytes;
    expect(seeded(1000).bytes).toBeGreaterThan(small);
  });
});

describe('F04-T3: deviceId join', () => {
  it('buffers lafparsed rows for unknown devices and applies them on insert', () => {
    const s = new FleetState({ pids: PIDS });
    s.applyLafparsed(LAF_FIELDS, [lafRow(1, BASE_T, 1, 1)]);
    s.applyLafparsed(LAF_FIELDS, [lafRow(1, BASE_T - 5, 0, 0)]);
    expect(s.pending.size).toBe(1);
    s.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, [snapshotRow(1)]);
    expect(s.pending.size).toBe(0);
    expect(s.summary(0).pids).toEqual({ mcu_charge_plug_status: 1, charger_status: 1 });
    expect(s.summary(0).lafparsedAt).toBe(BASE_T);
  });

  it('caps the buffer, dropping the oldest device first', () => {
    const s = new FleetState({ pids: PIDS, pendingMax: 3 });
    s.applyLafparsed(
      LAF_FIELDS,
      [0, 1, 2, 3, 4].map((n) => lafRow(n, BASE_T)),
    );
    expect([...s.pending.keys()]).toEqual(['d2', 'd3', 'd4']);
    s.applyLafparsed(LAF_FIELDS, [lafRow(2, BASE_T + 1)]);
    expect([...s.pending.keys()]).toEqual(['d3', 'd4', 'd2']);
  });

  it('ignores rows for devices out of scope once the buffer is closed', () => {
    const s = seeded(3);
    s.applyLafparsed(LAF_FIELDS, [lafRow(42, BASE_T)]);
    expect(s.pending.size).toBe(1);
    s.closePending();
    expect(s.pending.size).toBe(0);
    s.applyCombinfo(COMBINFO_LEAVE_FIELDS, [['v1', null]]);
    const v = s.version;
    expect(s.applyLafparsed(LAF_FIELDS, [lafRow(1, BASE_T), lafRow(42, BASE_T)])).toBe(0);
    expect(s.pending.size).toBe(0);
    expect(s.version).toBe(v);
  });
});
