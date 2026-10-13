// @vitest-environment node
import { fleetListSchema } from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer, toObjects, type LiveClient } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
const clients: LiveClient[] = [];

beforeAll(async () => {
  server = await startServer();
  cookie = await server.login(SEED_USERS.viewer);
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

describe('F01-T5: viewer scope', () => {
  it('lists only its hub subtree and its snapshot contains only hub vehicles', async () => {
    const fleets = (await server.api('GET', '/api/fleets', { cookie, schema: fleetListSchema }))
      .body;
    const hub = fleets.find((f) => f.name === 'Delhi Hub 1')!;
    expect(fleets.map((f) => f.name).sort()).toEqual(
      ['Delhi Hub 1', 'Delhi Hub 1 · Team A', 'Delhi Hub 1 · Team B'].sort(),
    );
    const c = await connect();
    c.send({
      type: 'subscribe',
      id: 'hub',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: [hub.id] },
    });
    const snap = await c.snapshot('hub');
    const allowed = new Set(fleets.map((f) => f.id));
    expect(snap.rows.length).toBe(hub.vehicleCount);
    expect(snap.rows.length).toBeGreaterThan(0);
    for (const row of toObjects(snap.fields, snap.rows))
      expect(allowed.has(row.fleetId as string)).toBe(true);
    const deltas = await c.waitFor('delta', (m) => m.id === 'hub', 3000);
    const ids = new Set(toObjects(snap.fields, snap.rows).map((r) => r.vehicleId));
    for (const row of toObjects(deltas.fields, deltas.rows))
      expect(ids.has(row.vehicleId)).toBe(true);
  });

  it('subscribing to a fleet outside its hub closes with 4403', async () => {
    const c = await connect();
    c.send({
      type: 'subscribe',
      id: 'x',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: ['f1'] },
    });
    expect(await c.waitClose()).toBe(4403);
  });

  it('subscribing to a vehicle outside its hub closes with 4403', async () => {
    const { sim, tree } = server.ctx;
    const outside = [...Array(sim.count).keys()].find(
      (i) => !tree.inScope(sim.fleetId(i), ['f3']),
    )!;
    const c = await connect();
    c.send({
      type: 'subscribe',
      id: 'v',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId: sim.vehicleId(outside) },
    });
    expect(await c.waitClose()).toBe(4403);
  });

  it('REST admin endpoints are forbidden for the viewer', async () => {
    expect((await server.api('GET', '/api/users', { cookie })).status).toBe(403);
    expect((await server.api('GET', '/api/vehicles', { cookie })).status).toBe(403);
    expect(
      (await server.api('POST', '/api/fleets', { cookie, body: { parentId: 'f3', name: 'x' } }))
        .status,
    ).toBe(403);
  });
});
