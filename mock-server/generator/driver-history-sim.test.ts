// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ASSIGNED_SHARE, DRIVER_SHARE, DriverSim } from './driver-sim.ts';
import { DAY_MS, HistorySim, istDay, istDayStart, KPI_COUNT, K, toKpis } from './history-sim.ts';
import { PERSONA, VehicleSim } from './vehicle-sim.ts';
import { FleetTree } from './fleet-tree.ts';

const HOUR = 3_600_000;
const tree = new FleetTree();
const sim = new VehicleSim(7, 3000, 5000, tree);

describe('F11-T1 DriverSim', () => {
  it('is deterministic for a seed', () => {
    const a = new DriverSim(7, sim);
    const b = new DriverSim(7, sim);
    expect(a.count).toBe(b.count);
    expect(a.assignedCount).toBe(b.assignedCount);
    for (const d of [0, 1, 17, a.count - 1]) {
      expect(a.name(d)).toBe(b.name(d));
      expect(a.phone(d)).toBe(b.phone(d));
      expect(a.driverVehicle[d]).toBe(b.driverVehicle[d]);
    }
    expect(new DriverSim(8, sim).name(0)).not.toBe(a.name(0) + 'x');
  });

  it('sizes and assigns per spec §5: ~0.85 × vehicles, only normal vehicles, 1:1', () => {
    const g = new DriverSim(7, sim);
    expect(g.count).toBe(Math.floor(sim.count * DRIVER_SHARE));
    const normal = [...Array(sim.count).keys()].filter((i) => sim.persona[i] === PERSONA.normal);
    expect(g.assignedCount / normal.length).toBeGreaterThan(ASSIGNED_SHARE - 0.05);
    expect(g.assignedCount / normal.length).toBeLessThan(ASSIGNED_SHARE + 0.05);
    for (let d = 0; d < g.assignedCount; d++) {
      const i = g.driverVehicle[d]!;
      expect(sim.persona[i]).toBe(PERSONA.normal);
      expect(g.vehicleDriver[i]).toBe(d);
      expect(g.fleet[d]).toBe(sim.fleet[i]);
    }
    for (let d = g.assignedCount; d < g.count; d++) expect(g.driverVehicle[d]).toBe(-1);
    expect(g.phone(0)).toMatch(/^\+91 9\d{4} \d{5}$/);
  });
});

describe('F11-T1 HistorySim', () => {
  const h = new HistorySim(sim);
  const day = istDay(Date.UTC(2026, 9, 1, 12));

  it('is deterministic for a seed', () => {
    const a = new Float64Array(KPI_COUNT);
    const b = new Float64Array(KPI_COUNT);
    new HistorySim(sim).addDay(5, day, 1, a);
    h.addDay(5, day, 1, b);
    expect([...a]).toEqual([...b]);
  });

  it('keeps every vehicle-day consistent: up + down = 24 h, drive + idle = up, distance = drive × speed', () => {
    for (let i = 0; i < sim.count; i += 7) {
      const acc = new Float64Array(KPI_COUNT);
      h.addDay(i, day, 1, acc);
      expect(acc[K.uptimeMs]! + acc[K.downtimeMs]!).toBeCloseTo(DAY_MS, 0);
      expect(acc[K.driveMs]! + acc[K.idleMs]!).toBeCloseTo(acc[K.uptimeMs]!, 0);
      expect(acc[K.idleMs]!).toBeGreaterThanOrEqual(0);
      expect(acc[K.distanceKm]!).toBeCloseTo((acc[K.driveMs]! / HOUR) * sim.speedKmh[i]!, 6);
      expect(acc[K.noGpsMs]!).toBeLessThanOrEqual(DAY_MS);
      if (sim.persona[i] === PERSONA.gpsNever) expect(acc[K.noGpsMs]).toBe(DAY_MS);
    }
  });

  it('splits ranges by IST day and weights partial days', () => {
    const from = istDayStart(day) + 6 * HOUR;
    const to = istDayStart(day + 2) + 12 * HOUR;
    const acc = new Float64Array(KPI_COUNT);
    h.addRange(3, from, to, acc);
    const expected = new Float64Array(KPI_COUNT);
    h.addDay(3, day, 0.75, expected);
    h.addDay(3, day + 1, 1, expected);
    h.addDay(3, day + 2, 0.5, expected);
    for (let k = 0; k < KPI_COUNT; k++) expect(acc[k]).toBeCloseTo(expected[k]!, 6);
    const kpis = toKpis(acc);
    expect(kpis.uptimeMs + kpis.downtimeMs).toBeCloseTo(2.25 * DAY_MS, -3);
  });
});
