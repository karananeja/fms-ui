// @vitest-environment node
import type { Me } from '@shared/contract/index.ts';
import { COMBINFO_DELTA_FIELDS, COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiveTrackingEngine,
  SUB_FLEET_COMBINFO,
  SUB_FLEET_LAFPARSED,
} from './live-tracking-engine.ts';
import { BASE_T, deltaRow, fakeSockets, snapshotRow } from './testing/fake-socket.ts';
import type { LivePush } from './worker-api.ts';

const me = { fleetIds: ['f0'], permissions: ['live.view'] } as unknown as Me;

function setup() {
  const s = fakeSockets();
  const pushes: { at: number; push: LivePush }[] = [];
  const engine = new LiveTrackingEngine({
    url: 'ws://test/ws/live',
    createSocket: s.create,
    random: () => 1,
  });
  engine.init(me, (push) => pushes.push({ at: Date.now(), push }));
  s.last().open();
  return { ...s, engine, pushes };
}

const snapshot = (id: string, rows: unknown[][], chunk = 0, chunks = 1) =>
  ({
    type: 'snapshot',
    id,
    seq: chunk + 1,
    chunk,
    chunks,
    fields: COMBINFO_SNAPSHOT_FIELDS,
    rows,
  }) as const;

let engine: LiveTrackingEngine | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  engine?.dispose();
  vi.useRealTimers();
});

describe('F04 engine', () => {
  it('subscribes to fleet combinfo + lafparsed with the configured PIDs on open', () => {
    const t = setup();
    engine = t.engine;
    expect(t.last().sent).toEqual([
      {
        type: 'subscribe',
        id: SUB_FLEET_COMBINFO,
        topic: 'combinfo',
        scope: { kind: 'fleet', fleetIds: ['f0'] },
      },
      {
        type: 'subscribe',
        id: SUB_FLEET_LAFPARSED,
        topic: 'lafparsed',
        scope: { kind: 'fleet', fleetIds: ['f0'] },
        pids: ['mcu_charge_plug_status', 'charger_status'],
      },
    ]);
  });

  it('F04-T1: the backoff attempt resets once a snapshot completes', () => {
    const t = setup();
    engine = t.engine;
    const reopenAfter = (ms: number) => {
      const n = t.sockets.length;
      t.last().serverClose(1006);
      vi.advanceTimersByTime(ms - 1);
      expect(t.sockets.length).toBe(n);
      vi.advanceTimersByTime(1);
      expect(t.sockets.length).toBe(n + 1);
      t.last().open();
    };
    reopenAfter(500);
    reopenAfter(1000);
    t.last().message(snapshot(SUB_FLEET_COMBINFO, [snapshotRow(1)]));
    reopenAfter(500);
  });

  it('F04-T3: the pending buffer closes 60 s after the snapshot completes', () => {
    const t = setup();
    engine = t.engine;
    const laf = (n: number) => ({
      type: 'delta' as const,
      id: SUB_FLEET_LAFPARSED,
      seq: 1,
      fields: ['deviceId', 'canutctime', 'mcu_charge_plug_status', 'charger_status'],
      rows: [[`d${n}`, BASE_T, 1, 1]],
    });
    t.last().message(laf(5));
    expect(t.engine.state.pending.size).toBe(1);
    t.last().message(snapshot(SUB_FLEET_COMBINFO, [snapshotRow(1)]));
    vi.advanceTimersByTime(59_000);
    t.last().message({ type: 'pong' });
    expect(t.engine.state.pending.size).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(t.engine.state.pending.size).toBe(0);
    t.last().message(laf(6));
    expect(t.engine.state.pending.size).toBe(0);
  });

  it('F04-T8: 100 changes/s produce at most 4 pushes per second and none while idle', () => {
    const t = setup();
    engine = t.engine;
    t.last().message(snapshot(SUB_FLEET_COMBINFO, [snapshotRow(1), snapshotRow(2)]));
    const start = Date.now();
    for (let k = 0; k < 300; k++) {
      vi.advanceTimersByTime(10);
      t.last().message({
        type: 'delta',
        id: SUB_FLEET_COMBINFO,
        seq: k + 2,
        fields: COMBINFO_DELTA_FIELDS,
        rows: [deltaRow(1, { utctime: BASE_T + k + 1, speed: k % 50 })],
      });
    }
    vi.advanceTimersByTime(1000);
    for (let sec = 0; sec < 3; sec++) {
      const inSec = t.pushes.filter(
        (p) => p.at >= start + sec * 1000 && p.at < start + (sec + 1) * 1000,
      );
      expect(inSec.length).toBeLessThanOrEqual(4);
      expect(inSec.length).toBeGreaterThanOrEqual(3);
    }
    // Rates settle to 0 within 2 s; afterwards nothing is pushed.
    vi.advanceTimersByTime(2000);
    const n = t.pushes.length;
    vi.advanceTimersByTime(5000);
    expect(t.pushes.length).toBe(n);
    const lastPush = t.pushes.at(-1)!.push;
    expect(lastPush.stats).toMatchObject({
      vehicleCount: 2,
      snapshotComplete: true,
      rowsPerSec: 0,
    });
    expect(lastPush.version).toBe(t.engine.state.version);
  });

  it('selectVehicle subscribes, keeps payloads, re-subscribes on reconnect and unsubscribes', () => {
    const t = setup();
    engine = t.engine;
    expect(t.engine.selectVehicle('v404')).toBe(false);
    t.last().message(snapshot(SUB_FLEET_COMBINFO, [snapshotRow(1), snapshotRow(2)]));
    t.last().sent.length = 0;
    expect(t.engine.selectVehicle('v1')).toBe(true);
    expect(t.last().sent.map((m) => m.type === 'subscribe' && [m.id, m.topic, m.scope])).toEqual([
      ['sel-c-1', 'combinfo', { kind: 'vehicle', vehicleId: 'v1' }],
      ['sel-l-1', 'lafparsed', { kind: 'vehicle', vehicleId: 'v1' }],
    ]);
    const data = { regno: 'X' } as never;
    t.last().message({ type: 'payload', id: 'sel-c-1', topic: 'combinfo', data });
    vi.advanceTimersByTime(300);
    expect(t.pushes.at(-1)!.push.selected).toMatchObject({
      vehicleId: 'v1',
      found: true,
      combinfo: data,
    });

    t.last().serverClose(1006);
    vi.advanceTimersByTime(500);
    t.last().open();
    expect(t.last().sent.map((m) => m.type === 'subscribe' && m.id)).toEqual([
      SUB_FLEET_COMBINFO,
      SUB_FLEET_LAFPARSED,
      'sel-c-2',
      'sel-l-2',
    ]);
    t.last().sent.length = 0;
    const before = t.pushes.length;
    t.engine.selectVehicle(null);
    expect(t.last().sent).toEqual([
      { type: 'unsubscribe', id: 'sel-c-2' },
      { type: 'unsubscribe', id: 'sel-l-2' },
    ]);
    vi.advanceTimersByTime(300);
    expect(t.pushes.slice(before).map((p) => p.push.selected)).toContain(null);
    // A late payload for the old subscription is ignored.
    const after = t.pushes.length;
    t.last().message({ type: 'payload', id: 'sel-c-2', topic: 'combinfo', data });
    vi.advanceTimersByTime(300);
    expect(t.pushes.length).toBeGreaterThan(after);
    expect(t.pushes.slice(after).some((p) => 'selected' in p.push)).toBe(false);
  });

  it('getVehicleSummary returns the slim record or null', () => {
    const t = setup();
    engine = t.engine;
    t.last().message(snapshot(SUB_FLEET_COMBINFO, [snapshotRow(1)]));
    expect(t.engine.getVehicleSummary('v1')).toMatchObject({ regno: 'KA01AB0001', soc: 80 });
    expect(t.engine.getVehicleSummary('nope')).toBeNull();
  });
});
