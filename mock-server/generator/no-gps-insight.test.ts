// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FleetTree } from './fleet-tree.ts';
import { likelyCause, noGpsInsight } from './no-gps-insight.ts';
import { PERSONA, VehicleSim } from './vehicle-sim.ts';

const none = { devBatteryLow: false, weakSignal: false, ignitionOff: false, deviceOffline: false };
const all = { devBatteryLow: true, weakSignal: true, ignitionOff: true, deviceOffline: true };

describe('F11-T4 likely no-GPS cause (spec §2 priority, first match wins)', () => {
  it.each([
    [{ ...all }, 'no-gps-device', 'driver-reported'],
    [{ ...all }, 'tyre', 'device-offline'],
    [{ ...all }, undefined, 'device-offline'],
    [{ ...all, deviceOffline: false }, undefined, 'device-battery-low'],
    [{ ...none, weakSignal: true, ignitionOff: true }, undefined, 'weak-signal'],
    [{ ...none, ignitionOff: true }, undefined, 'ignition-off'],
    [{ ...none }, undefined, 'unknown'],
    [{ ...none }, 'no-gps-device', 'driver-reported'],
  ] as const)('%o + reported %s → %s', (signals, reported, cause) => {
    expect(likelyCause(signals, reported)).toBe(cause);
  });

  it('gives an insight for no-GPS vehicles only, with varied seeded causes', () => {
    const sim = new VehicleSim(7, 4000, 5000, new FleetTree());
    const now = Date.UTC(2026, 9, 14, 6);
    const causes = new Set<string>();
    for (let i = 0; i < sim.count; i++) {
      const insight = noGpsInsight(sim, i, now);
      if (sim.persona[i] === PERSONA.normal) expect(insight).toBeNull();
      if (sim.persona[i] === PERSONA.gpsNever) expect(insight).toBeNull();
      if (sim.persona[i] === PERSONA.noGps) {
        expect(insight).not.toBeNull();
        expect(insight!.durationMs).toBe(now - insight!.since);
        expect(insight!.explanation.length).toBeGreaterThan(10);
        causes.add(insight!.likelyCause);
      }
    }
    expect(causes.size).toBeGreaterThanOrEqual(3);
  });
});
