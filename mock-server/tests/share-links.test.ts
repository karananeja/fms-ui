// @vitest-environment node
import {
  clockSchema,
  combinfoSchema,
  publicShareSchema,
  publicTrailSchema,
  shareLinkListSchema,
  shareLinkSchema,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA } from '../generator/vehicle-sim.ts';
import { SEED_USERS, startServer, type LiveClient } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let cookie: string;
let vehicleId: string;
const clients: LiveClient[] = [];

beforeAll(async () => {
  server = await startServer();
  cookie = await server.login(SEED_USERS.ops);
  const { sim, tree } = server.ctx;
  const i = [...Array(sim.count).keys()].find(
    (k) => sim.persona[k] === PERSONA.normal && tree.inScope(sim.fleetId(k), ['f1']),
  )!;
  vehicleId = sim.vehicleId(i);
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const shareWs = async (token: string) => {
  const c = await server.ws({ share: token });
  clients.push(c);
  return c;
};
const createLink = (show: { drivingEnergy: boolean; device: boolean }, expiresInMs = 3_600_000) =>
  server.api('POST', '/api/share-links', {
    cookie,
    body: {
      vehicleId,
      expiresAt: Date.now() + expiresInMs,
      show,
      trail: { enabled: true, windowMinutes: 30 },
    },
    schema: shareLinkSchema,
  });

describe('F01-T7: share links', () => {
  it('create → public fetch → redacted vehicle WS → revoke → 4410 and 410', async () => {
    const { api } = server;
    const created = await createLink({ drivingEnergy: false, device: false });
    expect(created.status).toBe(201);
    const link = created.body;
    expect(link.url).toBe(`/share/${link.token}`);
    expect(Buffer.from(link.token, 'base64url')).toHaveLength(32);

    const pub = await api('GET', `/api/public/share/${link.token}`, { schema: publicShareSchema });
    expect(pub.status).toBe(200);
    expect(pub.body.options.show).toEqual({ drivingEnergy: false, device: false });
    const trail = await api('GET', `/api/public/share/${link.token}/trail`, {
      schema: publicTrailSchema,
    });
    expect(trail.body.points.length).toBeGreaterThan(0);

    const listed = await api('GET', `/api/share-links?vehicleId=${vehicleId}`, {
      cookie,
      schema: shareLinkListSchema,
    });
    expect(listed.body.map((l) => l.id)).toContain(link.id);

    const c = await shareWs(link.token);
    c.send({
      type: 'subscribe',
      id: 'p',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId },
    });
    const payload = await c.waitFor('payload', (m) => m.id === 'p');
    const data = payload.data as Record<string, unknown>;
    for (const k of ['speed', 'deviceid', 'carbattery', 'devbattery', 'rxdbm'])
      expect(data).not.toHaveProperty(k);
    expect(Object.keys(data.parsedcandata as object)).toEqual(['immobilization_status']);
    expect(data.latitude).toEqual(expect.any(Number));
    c.send({
      type: 'subscribe',
      id: 'l',
      topic: 'lafparsed',
      scope: { kind: 'vehicle', vehicleId },
    });
    expect((await c.waitFor('error', (m) => m.id === 'l')).code).toBe('forbidden');
    expect(c.invalid).toEqual([]);

    expect((await api('DELETE', `/api/share-links/${link.id}`, { cookie })).status).toBe(204);
    expect(await c.waitClose()).toBe(4410);
    expect((await api('GET', `/api/public/share/${link.token}`)).status).toBe(410);
    expect((await api('GET', `/api/public/share/${link.token}/trail`)).status).toBe(410);
    const late = await shareWs(link.token);
    expect(await late.waitClose()).toBe(4410);
  });

  it('visible groups are sent in full; other vehicles are 4403', async () => {
    const link = (await createLink({ drivingEnergy: true, device: true })).body;
    const c = await shareWs(link.token);
    c.send({
      type: 'subscribe',
      id: 'p',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId },
    });
    combinfoSchema.parse((await c.waitFor('payload', (m) => m.id === 'p')).data);
    c.send({
      type: 'subscribe',
      id: 'l',
      topic: 'lafparsed',
      scope: { kind: 'vehicle', vehicleId },
    });
    await c.waitFor('payload', (m) => m.id === 'l');
    c.send({
      type: 'subscribe',
      id: 'f',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: ['f1'] },
    });
    expect(await c.waitClose()).toBe(4403);
  });

  it('expiry closes live sockets with 4410 and the fetch returns 410', async () => {
    const link = (await createLink({ drivingEnergy: true, device: false }, 60_000)).body;
    const c = await shareWs(link.token);
    c.send({
      type: 'subscribe',
      id: 'p',
      topic: 'combinfo',
      scope: { kind: 'vehicle', vehicleId },
    });
    await c.waitFor('payload');
    await server.api('POST', '/api/dev/clock', {
      body: { offsetMs: 120_000 },
      schema: clockSchema,
    });
    try {
      expect(await c.waitClose(2000)).toBe(4410);
      expect((await server.api('GET', `/api/public/share/${link.token}`)).status).toBe(410);
    } finally {
      await server.api('POST', '/api/dev/clock', { body: { offsetMs: 0 }, schema: clockSchema });
    }
  });

  it('trail is 404 when disabled; viewer cannot create links', async () => {
    const res = await server.api('POST', '/api/share-links', {
      cookie,
      body: {
        vehicleId,
        expiresAt: Date.now() + 60_000,
        show: { drivingEnergy: true, device: true },
        trail: { enabled: false, windowMinutes: 10 },
      },
      schema: shareLinkSchema,
    });
    expect((await server.api('GET', `/api/public/share/${res.body.token}/trail`)).status).toBe(404);
    const viewer = await server.login(SEED_USERS.viewer);
    const denied = await server.api('POST', '/api/share-links', {
      cookie: viewer,
      body: {
        vehicleId,
        expiresAt: Date.now() + 60_000,
        show: { drivingEnergy: true, device: true },
        trail: { enabled: false, windowMinutes: 10 },
      },
    });
    expect(denied.status).toBe(403);
  });
});
