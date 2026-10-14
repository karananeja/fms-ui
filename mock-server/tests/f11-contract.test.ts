// @vitest-environment node
import {
  analyticsSummarySchema,
  assignmentListSchema,
  driverListSchema,
  driverMeSchema,
  driverRequestSchema,
  driverSchema,
  noGpsInsightSchema,
  notificationListSchema,
  replacementCandidateListSchema,
  requestListSchema,
  type DriverMe,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA } from '../generator/vehicle-sim.ts';
import { SEED_USERS, startServer, type LiveClient } from '../testing/harness.ts';

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;
let me: DriverMe;
const clients: LiveClient[] = [];

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
  me = (
    await server.api('GET', '/api/driver/me', { cookie: cookies.driver, schema: driverMeSchema })
  ).body;
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const ws = async (cookie: string) => {
  const c = await server.ws({ cookie });
  clients.push(c);
  return c;
};
/** A vehicle of `persona` inside (or, with `inside: false`, outside) the given fleets. */
const vehicleWhere = (persona: number, fleets: string[], inside = true) => {
  const { sim, tree } = server.ctx;
  const i = [...Array(sim.count).keys()].find(
    (k) => sim.persona[k] === persona && tree.inScope(sim.fleetId(k), fleets) === inside,
  )!;
  return sim.vehicleId(i);
};
const opsFleets = () => server.ctx.accounts.user('u-ops').fleetIds;

describe('F11-T5 REST contract, scope and permissions', () => {
  it('seed driver: /driver/me has an assigned vehicle; staff endpoints are 403', async () => {
    expect(me.vehicle).not.toBeNull();
    expect(me.driver.userId).toBe('u-driver');
    for (const path of ['/api/drivers', '/api/analytics/summary', '/api/vehicles'])
      expect((await server.api('GET', path, { cookie: cookies.driver })).status).toBe(403);
  });

  it('driver creates a request (201) and only ever sees their own', async () => {
    const created = await server.api('POST', '/api/requests', {
      cookie: cookies.driver,
      body: { type: 'rsa', note: 'stuck' },
      schema: driverRequestSchema,
    });
    expect(created.status).toBe(201);
    expect(created.body.driverId).toBe(me.driver.id);
    const dup = await server.api('POST', '/api/requests', {
      cookie: cookies.driver,
      body: { type: 'rsa', note: 'again' },
    });
    expect(dup.status).toBe(409);
    const mine = await server.api('GET', '/api/requests', {
      cookie: cookies.driver,
      schema: requestListSchema,
    });
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((r) => r.driverId === me.driver.id)).toBe(true);
    expect(
      (
        await server.api('POST', `/api/requests/${created.body.id}/actions`, {
          cookie: cookies.driver,
          body: { action: 'acknowledge' },
        })
      ).status,
    ).toBe(403);
  });

  it('staff: drivers list, assignment history, suggestions and actions validate against the contract', async () => {
    const list = await server.api('GET', '/api/drivers?limit=5', {
      cookie: cookies.superadmin,
      schema: driverListSchema,
    });
    expect(list.body.items).toHaveLength(5);
    await server.api('GET', `/api/drivers/${me.driver.id}`, {
      cookie: cookies.superadmin,
      schema: driverSchema,
    });
    const hist = await server.api('GET', `/api/assignments?driverId=${me.driver.id}`, {
      cookie: cookies.superadmin,
      schema: assignmentListSchema,
    });
    expect(hist.body.length).toBeGreaterThan(0);

    const repl = await server.api('POST', '/api/requests', {
      cookie: cookies.driver,
      body: { type: 'replacement', note: '' },
      schema: driverRequestSchema,
    });
    const sugg = await server.api('GET', `/api/requests/${repl.body.id}/suggestions`, {
      cookie: cookies.superadmin,
      schema: replacementCandidateListSchema,
    });
    expect(sugg.status).toBe(200);
    const closed = await server.api('POST', `/api/requests/${repl.body.id}/actions`, {
      cookie: cookies.superadmin,
      body: { action: 'close', note: 'not needed' },
      schema: driverRequestSchema,
    });
    expect(closed.body.status).toBe('closed');
    const invalid = await server.api('POST', `/api/requests/${repl.body.id}/actions`, {
      cookie: cookies.superadmin,
      body: { action: 'approve' },
    });
    expect(invalid.status).toBe(409);
  });

  it('assigning a vehicle that already has a driver is 409', async () => {
    const { drivers, sim } = server.ctx;
    const other = [...Array(drivers.count).keys()].find(
      (d) => d !== drivers.byUserId('u-driver') && drivers.vehicleOf(d) >= 0,
    )!;
    const res = await server.api('PUT', `/api/drivers/${me.driver.id}/assignment`, {
      cookie: cookies.superadmin,
      body: { vehicleId: sim.vehicleId(drivers.vehicleOf(other)) },
    });
    expect(res.status).toBe(409);
  });

  it('no-GPS insight: 200 for a no-GPS vehicle in scope, 404 for a healthy one, hidden out of scope', async () => {
    const fleets = opsFleets();
    const noGps = vehicleWhere(PERSONA.noGps, fleets);
    const ok = await server.api('GET', `/api/vehicles/${noGps}/no-gps-insight`, {
      cookie: cookies.ops,
      schema: noGpsInsightSchema,
    });
    expect(ok.body.vehicleId).toBe(noGps);
    const healthy = vehicleWhere(PERSONA.normal, fleets);
    expect(
      (await server.api('GET', `/api/vehicles/${healthy}/no-gps-insight`, { cookie: cookies.ops }))
        .status,
    ).toBe(404);
    const outside = vehicleWhere(PERSONA.noGps, fleets, false);
    expect([403, 404]).toContain(
      (await server.api('GET', `/api/vehicles/${outside}/no-gps-insight`, { cookie: cookies.ops }))
        .status,
    );
  });

  it('analytics: Operator gets a summary for its scope; Viewer is 403', async () => {
    const s = await server.api('GET', '/api/analytics/summary', {
      cookie: cookies.ops,
      schema: analyticsSummarySchema,
    });
    expect(s.body.vehicleCount).toBeGreaterThan(0);
    expect(s.body.vehicleCount).toBeLessThan(server.ctx.sim.count);
    expect(
      (await server.api('GET', '/api/analytics/summary', { cookie: cookies.viewer })).status,
    ).toBe(403);
    expect(
      (
        await server.api('GET', `/api/analytics/summary?from=0&to=${100 * 86_400_000}`, {
          cookie: cookies.ops,
        })
      ).status,
    ).toBe(422);
  });

  it('notifications: list validates and mark-all-read clears the unread count', async () => {
    const before = await server.api('GET', '/api/notifications', {
      cookie: cookies.superadmin,
      schema: notificationListSchema,
    });
    expect(before.body.unreadCount).toBeGreaterThan(0);
    await server.api('POST', '/api/notifications/read', {
      cookie: cookies.superadmin,
      body: { all: true },
      schema: notificationListSchema.pick({ unreadCount: true }).partial().passthrough(),
    });
    const after = await server.api('GET', '/api/notifications?unread=true', {
      cookie: cookies.superadmin,
      schema: notificationListSchema,
    });
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.items).toHaveLength(0);
  });
});

describe('F11-T6 WS events topic', () => {
  it('a driver may only subscribe events with self scope', async () => {
    // Forbidden subscribes close the socket with 4403 (F01 convention).
    const c = await ws(cookies.driver);
    c.send({
      type: 'subscribe',
      id: 'c1',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: [me.driver.fleetId] },
    });
    expect(await c.waitClose()).toBe(4403);
    const e = await ws(cookies.driver);
    e.send({ type: 'subscribe', id: 'e1', topic: 'events', scope: { kind: 'self' } });
    await e.waitFor('subscribed', (m) => m.id === 'e1');
  });

  it('request updates reach the driver and in-scope staff, not out-of-scope staff', async () => {
    const { sim, tree } = server.ctx;
    const fleetId = sim.fleetId(sim.indexOf(me.vehicle!.meta.vehicleId));
    const driver = await ws(cookies.driver);
    driver.send({ type: 'subscribe', id: 'e', topic: 'events', scope: { kind: 'self' } });
    await driver.waitFor('subscribed');
    const admin = await ws(cookies.superadmin);
    admin.send({
      type: 'subscribe',
      id: 'e',
      topic: 'events',
      scope: { kind: 'fleet', fleetIds: [tree.rootId] },
    });
    await admin.waitFor('subscribed');
    const viewerFleets = server.ctx.accounts.user('u-viewer').fleetIds;
    const viewerSees = tree.inScope(fleetId, viewerFleets);
    const viewer = await ws(cookies.viewer);
    viewer.send({
      type: 'subscribe',
      id: 'e',
      topic: 'events',
      scope: { kind: 'fleet', fleetIds: viewerFleets },
    });
    await viewer.waitFor('subscribed');

    const r = await server.api('POST', '/api/requests', {
      cookie: cookies.driver,
      body: { type: 'breakdown', reason: 'tyre', note: '' },
      schema: driverRequestSchema,
    });
    await server.api('POST', `/api/requests/${r.body.id}/actions`, {
      cookie: cookies.superadmin,
      body: { action: 'acknowledge' },
      schema: driverRequestSchema,
    });
    const isAck = (m: { type: string }) =>
      'kind' in m &&
      m.kind === 'request' &&
      'data' in m &&
      (m.data as { id: string; status: string }).id === r.body.id &&
      (m.data as { status: string }).status === 'acknowledged';
    await driver.waitFor('event', isAck as never);
    await admin.waitFor('event', isAck as never);
    if (!viewerSees)
      await expect(viewer.waitFor('event', isAck as never, 500)).rejects.toThrow(/timed out/);
  });
});
