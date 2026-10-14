// @vitest-environment node
import {
  clockSchema,
  fleetListSchema,
  fleetSchema,
  healthSchema,
  inviteListSchema,
  inviteSchema,
  mailboxSchema,
  meSchema,
  moveVehiclesResultSchema,
  permissionCatalogueSchema,
  PERMISSIONS,
  publicShareSchema,
  publicTrailSchema,
  roleListSchema,
  roleSchema,
  shareLinkListSchema,
  shareLinkSchema,
  statsSchema,
  userListSchema,
  userSchema,
  vehicleListSchema,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_USERS, startServer } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
beforeAll(async () => {
  server = await startServer();
  cookie = await server.login(SEED_USERS.superadmin);
});
afterAll(() => server.close());

/** Every call goes through `api()`, which parses each response with its contract schema. */
describe('F01-T1: every REST response parses with its zod schema', () => {
  it('health, auth and permissions', async () => {
    const { api } = server;
    expect((await api('GET', '/api/health', { schema: healthSchema })).status).toBe(200);
    expect(
      (await api('GET', '/api/auth/me', { cookie, schema: meSchema })).body.permissions,
    ).toEqual([...PERMISSIONS]);
    const catalogue = await api('GET', '/api/permissions', {
      cookie,
      schema: permissionCatalogueSchema,
    });
    expect(catalogue.body.map((p) => p.id)).toEqual([...PERMISSIONS]);
  });

  it('fleets and vehicles', async () => {
    const { api } = server;
    const fleets = await api('GET', '/api/fleets', { cookie, schema: fleetListSchema });
    expect(fleets.body.find((f) => f.parentId === null)!.vehicleCount).toBe(2000);
    const created = await api('POST', '/api/fleets', {
      cookie,
      body: { parentId: 'f1', name: 'Contract' },
      schema: fleetSchema,
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    await api('PATCH', `/api/fleets/${id}`, {
      cookie,
      body: { name: 'Renamed', parentId: 'f2' },
      schema: fleetSchema,
    });

    const page1 = await api('GET', '/api/vehicles?limit=25', { cookie, schema: vehicleListSchema });
    expect(page1.body.items).toHaveLength(25);
    const page2 = await api('GET', `/api/vehicles?limit=25&cursor=${page1.body.nextCursor}`, {
      cookie,
      schema: vehicleListSchema,
    });
    expect(page2.body.items[0]!.vehicleId).not.toBe(page1.body.items[0]!.vehicleId);
    const regno = page1.body.items[3]!.regno;
    const search = await api('GET', `/api/vehicles?q=${regno.toLowerCase()}`, {
      cookie,
      schema: vehicleListSchema,
    });
    expect(search.body.items.map((v) => v.regno)).toContain(regno);

    const vid = page1.body.items[0]!.vehicleId;
    await api('POST', `/api/fleets/${id}/vehicles`, {
      cookie,
      body: { vehicleIds: [vid] },
      schema: moveVehiclesResultSchema,
    });
    const inFleet = await api('GET', `/api/vehicles?fleetId=${id}`, {
      cookie,
      schema: vehicleListSchema,
    });
    expect(inFleet.body.items.map((v) => v.vehicleId)).toEqual([vid]);
    await api('POST', `/api/fleets/${page1.body.items[0]!.fleetId}/vehicles`, {
      cookie,
      body: { vehicleIds: [vid] },
      schema: moveVehiclesResultSchema,
    });
    expect((await api('DELETE', `/api/fleets/${id}`, { cookie })).status).toBe(204);
  });

  it('users, roles and invites', async () => {
    const { api } = server;
    const users = await api('GET', '/api/users', { cookie, schema: userListSchema });
    expect(users.body).toHaveLength(4);
    const viewer = users.body.find((u) => u.email === 'viewer@fms.local')!;
    await api('PATCH', `/api/users/${viewer.id}`, {
      cookie,
      body: { fleetIds: ['f2'] },
      schema: userSchema,
    });

    const roles = await api('GET', '/api/roles', { cookie, schema: roleListSchema });
    expect(roles.body.find((r) => r.system)!.permissions).toEqual([...PERMISSIONS]);
    const role = await api('POST', '/api/roles', {
      cookie,
      body: { name: 'Auditor', permissions: ['table.view'] },
      schema: roleSchema,
    });
    expect(role.status).toBe(201);
    await api('PATCH', `/api/roles/${role.body.id}`, {
      cookie,
      body: { permissions: ['table.view', 'table.export'] },
      schema: roleSchema,
    });
    expect(
      (await api('PATCH', '/api/roles/role-super-admin', { cookie, body: { name: 'x' } })).status,
    ).toBe(409);

    const invite = await api('POST', '/api/invites', {
      cookie,
      body: { email: 'auditor@fms.local', roleId: role.body.id, fleetIds: ['f1'] },
      schema: inviteSchema,
    });
    expect((await api('DELETE', `/api/roles/${role.body.id}`, { cookie })).status).toBe(409);
    await api('POST', `/api/invites/${invite.body.id}/resend`, { cookie, schema: inviteSchema });
    await api('GET', '/api/invites', { cookie, schema: inviteListSchema });
    expect((await api('DELETE', `/api/invites/${invite.body.id}`, { cookie })).status).toBe(204);
    expect((await api('DELETE', `/api/roles/${role.body.id}`, { cookie })).status).toBe(204);
    await api('GET', '/api/dev/mailbox?to=auditor@fms.local', { schema: mailboxSchema });
  });

  it('share links and public endpoints', async () => {
    const { api, ctx } = server;
    const vehicleId = ctx.sim.vehicleId(0);
    const body = {
      vehicleId,
      expiresAt: Date.now() + 3_600_000,
      show: { drivingEnergy: true, device: false },
      trail: { enabled: true, windowMinutes: 15 },
    };
    const link = await api('POST', '/api/share-links', { cookie, body, schema: shareLinkSchema });
    await api('GET', '/api/share-links', { cookie, schema: shareLinkListSchema });
    await api('GET', `/api/public/share/${link.body.token}`, { schema: publicShareSchema });
    await api('GET', `/api/public/share/${link.body.token}/trail`, { schema: publicTrailSchema });
    expect((await api('DELETE', `/api/share-links/${link.body.id}`, { cookie })).status).toBe(204);
  });

  it('dev endpoints and error envelopes', async () => {
    const { api } = server;
    await api('GET', '/api/dev/stats', { schema: statsSchema });
    await api('POST', '/api/dev/clock', { body: { offsetMs: 0 }, schema: clockSchema });
    expect((await api('GET', '/api/nope')).status).toBe(404);
    expect((await api('GET', '/api/users')).status).toBe(401);
    const invalid = await api('POST', '/api/share-links', { cookie, body: { vehicleId: 1 } });
    expect(invalid.status).toBe(422);
    expect(
      (invalid.body as { error: { details: unknown[] } }).error.details.length,
    ).toBeGreaterThan(0);
    expect((await api('PATCH', '/api/fleets/f999', { cookie, body: { name: 'x' } })).status).toBe(
      404,
    );
  });
});
