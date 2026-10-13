// @vitest-environment node
import { COMBINFO_SNAPSHOT_FIELDS } from '@shared/contract/ws-protocol.ts';
import { describe, expect, it } from 'vitest';
import { INDIA_CITIES } from '../config/india-cities.ts';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { FleetState } from './fleet-state.ts';
import { MapIndex } from './map-index.ts';
import { StatusTracker } from './status-deriver.ts';
import { BASE_T, snapshotRow } from './testing/fake-socket.ts';
import type { MapViewport } from './worker-api.ts';

const VEHICLES = 100_000;
const KM_PER_DEG = 111.32;

/** 1 lakh vehicles spread like the mock generator: loops of 1.5–18 km around 40 city centres. */
function lakhFleet() {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const state = new FleetState({ pids: statusLafPids(statusRulesConfig), capacity: VEHICLES });
  const status = new StatusTracker(state, statusRulesConfig);
  status.now = BASE_T;
  const rows = Array.from({ length: VEHICLES }, (_, i) => {
    const [w, s, e, n] = INDIA_CITIES[i % INDIA_CITIES.length]!.bbox;
    const lat0 = (s + n) / 2;
    const r = (1.5 + rnd() * 16.5) / KM_PER_DEG;
    const th = rnd() * Math.PI * 2;
    const never = i % 100 === 0;
    return snapshotRow(i, {
      lat: never ? 0 : lat0 + r * Math.sin(th),
      lng: never ? 0 : (w + e) / 2 + (r * Math.cos(th)) / Math.cos((lat0 * Math.PI) / 180),
      heading: rnd() * 360,
      speed: i % 3 ? 0 : 25,
    });
  });
  state.applyCombinfo(COMBINFO_SNAPSHOT_FIELDS, rows);
  return state;
}

const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const out = fn();
  return [out, performance.now() - t0];
};

describe('F06-T5: map-index at 1 lakh vehicles', () => {
  it('rebuild ≤ 500 ms, any frame ≤ 100 ms', { timeout: 15_000 }, () => {
    const state = lakhFleet();
    expect(state.count).toBe(VEHICLES);
    const index = new MapIndex(state);
    const builds = [1, 2, 3].map((v) => (index.update(v, v * 10_000), index.buildMs));

    const pune = INDIA_CITIES.find((c) => c.name === 'Pune')!.bbox;
    const [pw, ps, pe, pn] = pune;
    const cx = (pw + pe) / 2;
    const cy = (ps + pn) / 2;
    const viewports: Record<string, MapViewport> = {
      'india z4': { bbox: [68.1, 6.5, 97.4, 35.7], zoom: 4.3 },
      'pune z10': { bbox: pune, zoom: 10 },
      'pune z13': { bbox: [cx - 0.08, cy - 0.05, cx + 0.08, cy + 0.05], zoom: 13 },
      'pune z15': { bbox: [cx - 0.1, cy - 0.1, cx + 0.1, cy + 0.1], zoom: 15 },
      'pune z16': { bbox: [cx + 0.03, cy - 0.01, cx + 0.06, cy + 0.01], zoom: 16 },
      'west z15 (capped)': { bbox: [72, 18, 75, 20.5], zoom: 15 },
    };
    const frames = Object.entries(viewports).map(([name, vp]) => {
      const [f, ms] = time(() => index.frame(vp));
      return { name, ms, clusters: f.clusters.count.length, points: f.points.ids.length };
    });
    const report = `rebuilds ${builds.map((b) => b.toFixed(0)).join('/')} ms; frames ${frames
      .map((f) => `${f.name}: ${f.ms.toFixed(1)} ms (${f.clusters} clusters, ${f.points} points)`)
      .join('; ')}`;
    console.log(`[F06-T5] ${report}`);

    expect(Math.max(...builds)).toBeLessThanOrEqual(500);
    for (const f of frames) {
      expect(f.ms, f.name).toBeLessThanOrEqual(100);
      expect(f.points, f.name).toBeLessThanOrEqual(5000);
    }
    expect(frames.find((f) => f.name.includes('capped'))!.clusters).toBeGreaterThan(0);
  });
});
