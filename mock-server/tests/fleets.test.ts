// @vitest-environment node
import {
  COMBINFO_LEAVE_FIELDS,
  COMBINFO_SNAPSHOT_FIELDS,
  fleetListSchema,
  fleetSchema,
  moveVehiclesResultSchema,
  vehicleListSchema,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer, toObjects, type LiveClient } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let admin: string;
const clients: LiveClient[] = [];

beforeAll(async () => {
  server = await startServer();
  admin = await server.login(SEED_USERS.superadmin);
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

describe('F01-T8: fleet tree and vehicle moves', () => {
  it('creating a 6th level returns 422 max_depth; level 5 is allowed', async () => {
    const { api } = server;
    const fleets = (await api('GET', '/api/fleets', { cookie: admin, schema: fleetListSchema }))
      .body;
    expect(fleets).toHaveLength(205);
    const team = fleets.find((f) => f.depth === 5)!;
    const hub = fleets.find((f) => f.depth === 4)!;
    const tooDeep = await api('POST', '/api/fleets', {
      cookie: admin,
      body: { parentId: team.id, name: 'Level 6' },
    });
    expect(tooDeep.status).toBe(422);
    expect((tooDeep.body as { error: { code: string } }).error.code).toBe('max_depth');
    const ok = await api('POST', '/api/fleets', {
      cookie: admin,
      body: { parentId: hub.id, name: 'Team Z' },
      schema: fleetSchema,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.depth).toBe(5);
    const city = fleets.find(
      (f) => f.depth === 3 && f.id !== fleets.find((x) => x.id === hub.parentId)?.id,
    )!;
    const moveDeep = await api('PATCH', `/api/fleets/${city.id}`, {
      cookie: admin,
      body: { parentId: team.id },
    });
    expect(moveDeep.status).toBe(422);
    expect((moveDeep.body as { error: { code: string } }).error.code).toBe('max_depth');
    expect((await api('DELETE', `/api/fleets/${ok.body.id}`, { cookie: admin })).status).toBe(204);
    expect((await api('DELETE', `/api/fleets/${hub.id}`, { cookie: admin })).status).toBe(409);
  });

  it('moving vehicles updates their fleetId in the next deltas (enter and leave)', async () => {
    const { api } = server;
    const opsCookie = await server.login(SEED_USERS.ops);
    const target = (
      await api('POST', '/api/fleets', {
        cookie: admin,
        body: { parentId: 'f1', name: 'Moves' },
        schema: fleetSchema,
      })
    ).body;
    const south = (
      await api('GET', '/api/fleets', { cookie: admin, schema: fleetListSchema })
    ).body.find((f) => f.name === 'South')!;
    const southVehicles = await api('GET', `/api/vehicles?fleetId=${south.id}&limit=2`, {
      cookie: admin,
      schema: vehicleListSchema,
    });
    const northVehicles = await api('GET', '/api/vehicles?fleetId=f2&limit=1', {
      cookie: admin,
      schema: vehicleListSchema,
    });
    const incoming = southVehicles.body.items.map((v) => v.vehicleId);
    const outgoing = northVehicles.body.items[0]!.vehicleId;
    expect(incoming).toHaveLength(2);

    const root = await server.ws({ cookie: admin });
    const ops = await server.ws({ cookie: opsCookie });
    clients.push(root, ops);
    root.send({
      type: 'subscribe',
      id: 'all',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: ['f0'] },
    });
    ops.send({
      type: 'subscribe',
      id: 'north',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: ['f1'] },
    });
    await root.snapshot('all');
    await ops.snapshot('north');

    const moved = await api('POST', `/api/fleets/${target.id}/vehicles`, {
      cookie: admin,
      body: { vehicleIds: incoming },
      schema: moveVehiclesResultSchema,
    });
    expect(moved.body.moved).toBe(2);
    await api('POST', `/api/fleets/${south.id}/vehicles`, {
      cookie: admin,
      body: { vehicleIds: [outgoing] },
      schema: moveVehiclesResultSchema,
    });

    const rootMove = await root.waitFor('delta', (m) => m.fields.includes('fleetId'), 2000);
    expect(rootMove.fields).toEqual(COMBINFO_SNAPSHOT_FIELDS);
    const rootRows = toObjects(rootMove.fields, rootMove.rows);
    expect(
      rootRows.filter((r) => incoming.includes(r.vehicleId as string)).map((r) => r.fleetId),
    ).toEqual([target.id, target.id]);
    expect(rootRows.find((r) => r.vehicleId === outgoing)!.fleetId).toBe(south.id);

    const enter = await ops.waitFor(
      'delta',
      (m) => m.fields.length === COMBINFO_SNAPSHOT_FIELDS.length,
      2000,
    );
    expect(
      toObjects(enter.fields, enter.rows)
        .map((r) => r.vehicleId)
        .sort(),
    ).toEqual([...incoming].sort());
    const leave = await ops.waitFor(
      'delta',
      (m) => m.fields.length === COMBINFO_LEAVE_FIELDS.length,
      2000,
    );
    expect(leave.rows).toEqual([[outgoing, null]]);

    const listed = await api('GET', `/api/vehicles?fleetId=${target.id}`, {
      cookie: admin,
      schema: vehicleListSchema,
    });
    expect(listed.body.items.map((v) => v.vehicleId).sort()).toEqual([...incoming].sort());
    expect(root.invalid).toEqual([]);
    expect(ops.invalid).toEqual([]);
  });
});
