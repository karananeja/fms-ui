// @vitest-environment node
import {
  COMBINFO_DELTA_FIELDS,
  COMBINFO_SNAPSHOT_FIELDS,
  combinfoSchema,
  fleetListSchema,
  lafparsedSchema,
  rowSchema,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer, type LiveClient } from '../testing/harness.ts';

const BATCH_MS = 500;
let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
const clients: LiveClient[] = [];

beforeAll(async () => {
  server = await startServer({ batchMs: BATCH_MS, snapshotChunk: 200 });
  cookie = await server.login(SEED_USERS.ops);
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const connect = async () => {
  const c = await server.ws({ cookie });
  clients.push(c);
  return c;
};

describe('WS /ws/live contract', () => {
  it('F01-T2: ops gets subscribed, then snapshot chunks, then a delta within 2 × MOCK_BATCH_MS', async () => {
    const fleets = (await server.api('GET', '/api/fleets', { cookie, schema: fleetListSchema }))
      .body;
    const north = fleets.find((f) => f.name === 'North')!;
    const c = await connect();
    c.send({
      type: 'subscribe',
      id: 's1',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: [north.id] },
    });

    const snap = await c.snapshot('s1');
    const snapshotDoneAt = Date.now();
    const delta = await c.waitFor('delta', (m) => m.id === 's1', 2 * BATCH_MS);
    expect(Date.now() - snapshotDoneAt).toBeLessThanOrEqual(2 * BATCH_MS);

    const types = c.messages.map((m) => m.type);
    expect(types[0]).toBe('subscribed');
    expect(types.indexOf('delta')).toBeGreaterThan(types.lastIndexOf('snapshot'));
    expect(snap.chunks.map((m) => m.chunk)).toEqual([...Array(snap.chunks[0]!.chunks).keys()]);
    expect(snap.chunks.length).toBeGreaterThan(1);
    expect(snap.fields).toEqual(COMBINFO_SNAPSHOT_FIELDS);
    expect(snap.rows).toHaveLength(north.vehicleCount);
    const snapRow = rowSchema(snap.fields);
    for (const r of snap.rows) snapRow.parse(r);

    expect(delta.fields).toEqual(COMBINFO_DELTA_FIELDS);
    expect(delta.rows.length).toBeGreaterThan(0);
    const deltaRow = rowSchema(delta.fields);
    for (const r of delta.rows) deltaRow.parse(r);

    const seqs = c.messages.flatMap((m) => ('seq' in m ? [m.seq] : []));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(c.invalid).toEqual([]);
  });

  it('lafparsed fleet scope carries deviceId, canutctime and the requested PIDs', async () => {
    const c = await connect();
    const pids = ['soc', 'mcu_charge_plug_status', 'charger_status'];
    c.send({
      type: 'subscribe',
      id: 'l1',
      topic: 'lafparsed',
      scope: { kind: 'fleet', fleetIds: ['f1'] },
      pids,
    });
    const snap = await c.snapshot('l1');
    expect(snap.fields).toEqual(['deviceId', 'canutctime', ...pids]);
    for (const r of snap.rows) rowSchema(snap.fields).parse(r);
    c.send({
      type: 'subscribe',
      id: 'l2',
      topic: 'lafparsed',
      scope: { kind: 'fleet', fleetIds: ['f1'] },
      pids: ['nope'],
    });
    const err = await c.waitFor('error', (m) => m.id === 'l2');
    expect(err.code).toBe('validation_failed');
    expect(c.invalid).toEqual([]);
  });

  it('vehicle scope sends full sample-shaped payloads immediately; ping → pong', async () => {
    const { sim, tree } = server.ctx;
    const i = [...Array(sim.count).keys()].find((k) => tree.inScope(sim.fleetId(k), ['f1']))!;
    const vehicleId = sim.vehicleId(i);
    const c = await connect();
    c.send({
      type: 'subscribe',
      id: 'v1',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId },
    });
    c.send({
      type: 'subscribe',
      id: 'v2',
      topic: 'lafparsed',
      scope: { kind: 'vehicle', vehicleId },
    });
    const comb = await c.waitFor('payload', (m) => m.id === 'v1');
    const laf = await c.waitFor('payload', (m) => m.id === 'v2');
    expect(combinfoSchema.parse(comb.data).vehicleid).toBe(vehicleId);
    expect(Object.keys(lafparsedSchema.parse(laf.data).candata)).toHaveLength(374);
    c.send({ type: 'ping' });
    await c.waitFor('pong');
    c.send({
      type: 'subscribe',
      id: 'v1',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId },
    });
    expect((await c.waitFor('error', (m) => m.id === 'v1')).code).toBe('conflict');
    expect(c.invalid).toEqual([]);
  });

  it('an unauthenticated socket is closed with 4401', async () => {
    const c = await server.ws();
    clients.push(c);
    expect(await c.waitClose()).toBe(4401);
  });
});
