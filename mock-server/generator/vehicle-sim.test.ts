// @vitest-environment node
import {
  combinfoSchema,
  COMBINFO_SNAPSHOT_FIELDS,
  lafparsedSchema,
  rowSchema,
} from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import combinfoSample from '../fixtures/combinfo-sample.json' with { type: 'json' };
import lafparsedSample from '../fixtures/lafparsed-sample.json' with { type: 'json' };
import { FleetTree } from './fleet-tree.ts';
import { VehicleSim } from './vehicle-sim.ts';

const N = 100_000;
const T = Date.UTC(2026, 9, 13, 6, 30);
const sim = (seed = 42, count = N) => new VehicleSim(seed, count, 10_000, new FleetTree());

/** Reference implementation of the F05 rules (first match wins), fed only with wire fields. */
const MIN = 60_000;
function referenceStatus(
  now: number,
  c: Record<string, number>,
  laf: Record<string, number | null>,
) {
  if ((c.lat === 0 && c.lng === 0) || c.lat == null || c.lng == null) return 'gps-never';
  if (now - c.utctime! > 30 * MIN) return 'non-comm';
  if (c.carbattery! < 1.0) return 'pullout';
  if (c.immobilization_status === 1) return 'immobilized';
  if (laf.mcu_charge_plug_status === 1 || laf.charger_status !== 0) return 'charging';
  if (now - c.gpstime! > 10 * MIN) return 'no-gps';
  if (c.ignstatus === 1 && c.speed! > 2) return 'running';
  return 'stopped';
}

describe('vehicle generator', () => {
  it('F01-T3: is deterministic for the same seed and time, and yields MOCK_VEHICLES rows', () => {
    const a = sim();
    const b = sim();
    const schema = rowSchema(COMBINFO_SNAPSHOT_FIELDS);
    let rows = 0;
    for (let i = 0; i < a.count; i++) {
      const row = a.snapshotRow(i, T);
      rows++;
      if (i % 997 === 0) {
        expect(b.snapshotRow(i, T)).toEqual(row);
        expect(schema.safeParse(row).success).toBe(true);
      }
    }
    expect(rows).toBe(N);
    for (const i of [0, 1, 4242, N - 1]) {
      expect(b.combinfo(i, T)).toEqual(a.combinfo(i, T));
      expect(b.lafparsed(i, T)).toEqual(a.lafparsed(i, T));
    }
    const other = sim(7, 10);
    expect(other.snapshotRow(3, T)).not.toEqual(a.snapshotRow(3, T));
  });

  it('F01-T4: raw fields over 100k vehicles produce every F05 status (and roughly the target mix)', () => {
    const s = sim();
    const fields = [
      'lat',
      'lng',
      'speed',
      'heading',
      'ignstatus',
      'carbattery',
      'devbattery',
      'fixquality',
      'utctime',
      'gpstime',
      'canutctime',
      'soc',
      'dte',
      'odometer',
      'immobilization_status',
    ];
    const pids = ['mcu_charge_plug_status', 'charger_status'];
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const live = s.liveRow(i, T) as number[];
      const c = Object.fromEntries(fields.map((f, k) => [f, live[k]!]));
      const lafRow = s.lafRow(i, T, pids);
      const laf = {
        mcu_charge_plug_status: lafRow[2] as number,
        charger_status: lafRow[3] as number,
      };
      const status = referenceStatus(T, c, laf);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    // The spec's target shares sum to 96%; the remainder lands mostly on "stopped".
    const target = {
      running: 35,
      stopped: 30,
      charging: 8,
      'non-comm': 8,
      'no-gps': 5,
      pullout: 5,
      immobilized: 4,
      'gps-never': 1,
    };
    for (const [status, pct] of Object.entries(target)) {
      expect(counts[status], status).toBeGreaterThan(0);
      expect(Math.abs((100 * counts[status]!) / N - pct), status).toBeLessThan(5);
    }
  });

  it('vehicle-scope payloads match the sample shapes exactly', () => {
    const s = sim(42, 50);
    for (let i = 0; i < 50; i++) {
      const c = s.combinfo(i, T);
      const l = s.lafparsed(i, T);
      expect(combinfoSchema.parse(c)).toBeTruthy();
      expect(lafparsedSchema.parse(l)).toBeTruthy();
      expect(Object.keys(c)).toEqual(
        Object.keys(combinfoSample).filter((k) => k !== 'displayStatus'),
      );
      expect(Object.keys(c.appmeta)).toEqual(Object.keys(combinfoSample.appmeta));
      expect(Object.keys(c.parsedcandata)).toEqual(Object.keys(combinfoSample.parsedcandata));
      expect(Object.keys(l)).toEqual(Object.keys(lafparsedSample));
      expect(Object.keys(l.candata)).toEqual(Object.keys(lafparsedSample.candata));
      expect(c.chasiss).toHaveLength(17);
      expect(c.regno).toMatch(/^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/);
    }
  });

  it('trails are recomputed from time, oldest first, one point per report', () => {
    const s = sim(42, 200);
    const i = [...Array(200).keys()].find((k) => s.persona[k] === 0)!;
    const points = s.trail(i, T - 30 * MIN, T);
    expect(points.length).toBeGreaterThan(100);
    expect(points.length).toBeLessThan(250);
    for (let k = 1; k < points.length; k++)
      expect(points[k]![2]).toBeGreaterThan(points[k - 1]![2]);
    const last = s.state(i, T);
    expect(points.at(-1)!.slice(0, 2)).toEqual([last.lng, last.lat]);
  });
});
