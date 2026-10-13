// @vitest-environment node
import { meSchema, type ClientMessage } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SEED_USERS, startServer } from '../../../../mock-server/testing/harness.ts';
import { statusLafPids, statusRulesConfig } from '../config/status-rules-config.ts';
import { LiveTrackingEngine } from './live-tracking-engine.ts';
import { deriveStatus } from './status-deriver.ts';
import type { SocketLike } from './ws-client.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(check: () => boolean, timeoutMs: number, what: string) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(20);
  }
}

/** D-030 personas + duty cycle, as asserted by F01-T4 (percent of the fleet). */
const TARGET_MIX = {
  running: 35,
  stopped: 30,
  charging: 8,
  'non-comm': 8,
  'no-gps': 5,
  pullout: 5,
  immobilized: 4,
  'gps-never': 1,
};

describe('F05-T6: engine vs in-process mock (2000 vehicles)', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let engine: LiveTrackingEngine | undefined;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    engine?.dispose();
    await server.close();
  });

  it('all 8 statuses appear within ±5 points of D-030, using config-derived lafparsed PIDs', async () => {
    const cookie = await server.login(SEED_USERS.superadmin);
    const me = (await server.api('GET', '/api/auth/me', { cookie, schema: meSchema })).body;
    const sent: ClientMessage[] = [];
    engine = new LiveTrackingEngine({
      url: `${server.base.replace(/^http/, 'ws')}/ws/live`,
      createSocket: (url) => {
        const ws = new WebSocket(url, { headers: { cookie } });
        const send = ws.send.bind(ws);
        ws.send = ((data: string) => {
          sent.push(JSON.parse(data) as ClientMessage);
          send(data);
        }) as typeof ws.send;
        return ws as unknown as SocketLike;
      },
      random: () => 1,
    });
    const e = engine;
    e.init(me, () => {});
    await waitUntil(() => e.stats.snapshotComplete && e.state.count === 2000, 5000, 'snapshot');
    const lafAt = e.state.cols.lafparsedAt!;
    await waitUntil(
      () => !lafAt.subarray(0, e.state.count).some(Number.isNaN),
      3000,
      'lafparsed joined for every vehicle',
    );

    const laf = sent.find((m) => m.type === 'subscribe' && m.topic === 'lafparsed');
    expect(laf).toMatchObject({ pids: statusLafPids(statusRulesConfig) });
    expect(e.state.pids).toEqual(['mcu_charge_plug_status', 'charger_status']);

    const now = e.now();
    e.status.sweep(now);
    const counts = e.status.statusCounts();
    const total = e.state.count;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(total);
    const mix = Object.fromEntries(
      VEHICLE_STATUSES.map((s) => [s, +((100 * counts[s]) / total).toFixed(1)]),
    );
    console.log(`[F05-T6] status mix (% of ${total}): ${JSON.stringify(mix)}`);
    for (const s of VEHICLE_STATUSES) {
      expect(counts[s], s).toBeGreaterThan(0);
      expect(Math.abs(mix[s]! - TARGET_MIX[s]), s).toBeLessThanOrEqual(5);
    }

    // The vectorised sweep agrees with the pure single-vehicle evaluation.
    for (const id of e.state.str.vehicleId) {
      const v = e.getVehicleSummary(id)!;
      expect(v.status, id).toBe(deriveStatus(v, now));
    }
  }, 15_000);
});
