// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildServer } from '../build-server.ts';
import { openDatabase } from '../db/database.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { hashToken } from '../store/accounts.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

const ANY = z.unknown();
const dir = mkdtempSync(join(tmpdir(), 'fms-f22-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Server = Awaited<ReturnType<typeof startServer>>;
const boot = (dbPath: string, opts: Parameters<typeof startServer>[0] = {}) =>
  startServer({ dbPath, ...opts });

const count = (s: Server, table: string) =>
  (s.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

async function get<T = unknown>(s: Server, path: string, cookie?: string): Promise<T> {
  const res = await s.api('GET', path, { cookie, schema: ANY });
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as T;
}
async function send<T = unknown>(
  s: Server,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<T> {
  const res = await s.api(method, path, { cookie, body, schema: ANY });
  expect(res.status, `${method} ${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body as T;
}
async function mailToken(s: Server, to: string): Promise<string> {
  const mails = await get<{ token: string }[]>(s, `/api/dev/mailbox?to=${to}`);
  return mails.at(-1)!.token;
}
async function acceptInvite(s: Server, to: string, name: string): Promise<string> {
  const res = await s.api('POST', '/api/auth/accept-invite', {
    body: { token: await mailToken(s, to), name, password: 'Runtime@123' },
    schema: ANY,
  });
  expect(res.status).toBe(200);
  return res.cookie!;
}

describe('F22-T2 seeding', () => {
  it('seeds an empty file once; refuses a foreign seed; MOCK_DB_RESET re-seeds', async () => {
    const path = join(dir, 't2.db');
    let s = await boot(path);
    expect(s.ctx.db.prepare('SELECT seed, vehicles, seed_version FROM seed_state').all()).toEqual([
      { seed: 42, vehicles: 2000, seed_version: 1 },
    ]);
    for (const u of Object.values(SEED_USERS)) await s.login(u);
    expect(count(s, 'fleets')).toBe(205);
    const link = s.ctx.db
      .prepare("SELECT driver_idx FROM driver_patches WHERE user_id = 'u-driver'")
      .get() as { driver_idx: number };
    expect(s.ctx.accounts.user('u-driver').name).toBe(s.ctx.drivers.name(link.driver_idx));
    expect(s.ctx.drivers.byUserId('u-driver')).toBe(link.driver_idx);
    const salts = s.ctx.db.prepare('SELECT id, salt FROM users ORDER BY id').all();
    const counts = ['roles', 'users', 'fleets', 'notifications'].map((t) => count(s, t));
    await s.close();

    s = await boot(path);
    expect(s.ctx.db.prepare('SELECT id, salt FROM users ORDER BY id').all()).toEqual(salts);
    expect(['roles', 'users', 'fleets', 'notifications'].map((t) => count(s, t))).toEqual(counts);
    await send(s, 'POST', '/api/roles', await s.login(SEED_USERS.superadmin), {
      name: 'Temp',
      permissions: ['live.view'],
    });
    await s.close();

    await expect(boot(path, { seed: 43 })).rejects.toThrow(
      'Database was seeded with seed 42 / 2000 vehicles (v1); this server has seed 43 / 2000 vehicles (v1). Start with MOCK_DB_RESET=1 to wipe and re-seed, or use another MOCK_DB.',
    );
    await expect(boot(path, { vehicles: 1000 })).rejects.toThrow(/MOCK_DB_RESET=1/);

    s = await boot(path, { dbReset: true });
    expect(count(s, 'roles')).toBe(4);
    expect(s.ctx.db.prepare('SELECT id, salt FROM users ORDER BY id').all()).not.toEqual(salts);
    await s.login(SEED_USERS.ops);
    await s.close();
  });

  it('an F18-era (v2, dashboards only) file upgrades, seeds and keeps its dashboards', async () => {
    const path = join(dir, 'f18-era.db');
    const v2 = openDatabase(path, MIGRATIONS.slice(0, 2));
    v2.exec(`INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at)
      VALUES ('d-f18', 'u-superadmin', 'Old board', '[]', '{"lg":[],"md":[],"sm":[]}', 1, 1)`);
    v2.close();
    const s = await boot(path);
    expect(
      s.ctx.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get(),
    ).toEqual({ v: MIGRATIONS.at(-1)!.version });
    expect(count(s, 'seed_state')).toBe(1);
    const list = await get(s, '/api/dashboards', await s.login(SEED_USERS.superadmin));
    expect(JSON.stringify(list)).toContain('"id":"d-f18"');
    expect(JSON.stringify(list)).toContain('"ownerName":"Super Admin"');
    await s.close();
  });
});

describe('F22-T3 + T6 restart keeps admin data and sessions', () => {
  it('everything written over HTTP reads back identical after a restart, with the old cookies', async () => {
    const path = join(dir, 't3.db');
    let s = await boot(path);
    const { ctx } = s;
    const sa = await s.login(SEED_USERS.superadmin);
    const ops = await s.login(SEED_USERS.ops);
    const drv = await s.login(SEED_USERS.driver);
    const root = ctx.tree.rootId;

    // Roles, runtime user, user fleets.
    const role = await send<{ id: string }>(s, 'POST', '/api/roles', sa, {
      name: 'Dispatcher',
      permissions: ['live.view', 'dashboards.use'],
    });
    await send(s, 'PATCH', `/api/roles/${role.id}`, sa, { name: 'Dispatcher 2' });
    await send(s, 'POST', '/api/invites', sa, {
      email: 'rt@fms.local',
      roleId: role.id,
      fleetIds: [root],
    });
    const rt = await acceptInvite(s, 'rt@fms.local', 'Runtime User');
    await send(s, 'POST', '/api/invites', sa, {
      email: 'pending@fms.local',
      roleId: 'role-viewer',
      fleetIds: [root],
    });
    const north = [...ctx.tree.byId.values()].find((f) => f.name === 'North')!.id;
    await send(s, 'PATCH', '/api/users/u-viewer', sa, { fleetIds: [north] });

    // Fleets: create, rename, re-parent; move vehicles.
    const depot = await send<{ id: string }>(s, 'POST', '/api/fleets', sa, {
      parentId: root,
      name: 'Depot X',
    });
    await send(s, 'PATCH', `/api/fleets/${depot.id}`, sa, { name: 'Depot Y' });
    const child = await send<{ id: string }>(s, 'POST', '/api/fleets', sa, {
      parentId: root,
      name: 'Child',
    });
    await send(s, 'PATCH', `/api/fleets/${child.id}`, sa, { parentId: depot.id });
    const free = [...Array(ctx.sim.count).keys()].filter(
      (i) => ctx.drivers.driverOf(i) < 0 && ctx.sim.fleet[i] !== 0,
    );
    const moved = free.slice(0, 3).map((i) => ctx.sim.vehicleId(i));
    await send(s, 'POST', `/api/fleets/${child.id}/vehicles`, sa, { vehicleIds: moved });

    // Drivers: create with invite (linked on accept), edit, assign; reassign a seed driver.
    const nd = await send<{ id: string }>(s, 'POST', '/api/drivers', sa, {
      name: 'New Driver',
      phone: '+91 91234 56789',
      fleetId: root,
      invite: true,
      email: 'nd@fms.local',
    });
    const ndCookie = await acceptInvite(s, 'nd@fms.local', 'Nd User');
    await send(s, 'PATCH', `/api/drivers/${nd.id}`, sa, { name: 'New Driver 2' });
    const freeVehicle = ctx.sim.vehicleId(free[5]!);
    await send(s, 'PUT', `/api/drivers/${nd.id}/assignment`, sa, { vehicleId: freeVehicle });
    // T6: end a seed assignment, then reassign that driver twice.
    let seedD = 1;
    while (ctx.drivers.vehicleOf(seedD) < 0 || ctx.drivers.byUserId('u-driver') === seedD) seedD++;
    const seedVehicle = ctx.drivers.vehicleOf(seedD);
    await send(s, 'DELETE', `/api/drivers/drv-${seedD}/assignment`, sa);
    await send(s, 'PUT', `/api/drivers/drv-${seedD}/assignment`, sa, {
      vehicleId: ctx.sim.vehicleId(free[6]!),
    });
    await send(s, 'PUT', `/api/drivers/drv-${seedD}/assignment`, sa, {
      vehicleId: ctx.sim.vehicleId(free[7]!),
    });

    // Requests: breakdown acknowledged; replacement waiting (every candidate occupied).
    const bd = await send<{ id: string }>(s, 'POST', '/api/requests', drv, {
      type: 'breakdown',
      reason: 'tyre',
      note: 'flat',
    });
    await send(s, 'POST', `/api/requests/${bd.id}/actions`, sa, { action: 'acknowledge' });
    const meD = ctx.drivers.byUserId('u-driver');
    const fleetOfMine = ctx.sim.fleet[ctx.drivers.vehicleOf(meD)]!;
    let spare = ctx.drivers.gen.assignedCount;
    for (let i = 0; i < ctx.sim.count; i++) {
      if (ctx.sim.fleet[i] !== fleetOfMine || ctx.drivers.driverOf(i) >= 0) continue;
      while (ctx.drivers.vehicleOf(spare) >= 0 || ctx.drivers.status(spare) === 'disabled') spare++;
      ctx.drivers.assign(spare++, i, 'test');
    }
    const repl = await send<{ id: string; status: string }>(s, 'POST', '/api/requests', drv, {
      type: 'replacement',
      note: '',
    });
    expect(repl.status).toBe('waiting');
    await send(s, 'PATCH', `/api/fleets/${depot.id}/settings`, sa, { autoAssignReplacement: true });

    // Notifications: superadmin reads one by id; ops marks all.
    const ntf = await get<{ items: { id: string }[] }>(s, '/api/notifications?limit=5', sa);
    await send(s, 'POST', '/api/notifications/read', sa, { ids: [ntf.items[1]!.id] });
    await send(s, 'POST', '/api/notifications/read', ops, { all: true });

    // Share links: one live, one revoked.
    const shareBody = {
      vehicleId: ctx.sim.vehicleId(0),
      expiresAt: ctx.clock.now() + 3_600_000,
      show: { drivingEnergy: true, device: false },
      trail: { enabled: true, windowMinutes: 30 },
    };
    const live = await send<{ token: string }>(s, 'POST', '/api/share-links', sa, shareBody);
    const dead = await send<{ id: string; token: string }>(s, 'POST', '/api/share-links', sa, shareBody);
    await send(s, 'DELETE', `/api/share-links/${dead.id}`, sa);

    // Runtime user's dashboard.
    await send(s, 'POST', '/api/dashboards', rt, { title: 'RT board' });

    const snapshot = async (srv: Server) => ({
      meRt: await get(srv, '/api/auth/me', rt),
      meDrv: await get(srv, '/api/auth/me', drv),
      roles: await get(srv, '/api/roles', sa),
      users: await get(srv, '/api/users', sa),
      invites: await get(srv, '/api/invites', sa),
      fleets: await get(srv, '/api/fleets', sa),
      vehicles: await get(srv, `/api/vehicles?fleetId=${child.id}`, sa),
      nd: await get(srv, `/api/drivers/${nd.id}`, sa),
      ndMe: await get(srv, '/api/driver/me', ndCookie).then((m) => (m as { driver: unknown }).driver),
      ndHistory: await get(srv, `/api/assignments?driverId=${nd.id}`, sa),
      seedHistory: await get(srv, `/api/assignments?driverId=drv-${seedD}`, sa),
      seedVehicleHistory: await get(
        srv,
        `/api/assignments?vehicleId=${ctx.sim.vehicleId(seedVehicle)}`,
        sa,
      ),
      vehicleDriver: await get(srv, `/api/vehicles/${freeVehicle}/driver`, sa),
      drivers: await get(srv, '/api/drivers?limit=50', sa),
      requests: await get(srv, '/api/requests?limit=100', sa),
      settings: await get(srv, `/api/fleets/${depot.id}/settings`, sa),
      childSettings: await get(srv, `/api/fleets/${child.id}/settings`, sa),
      ntfSa: await get(srv, '/api/notifications?limit=200', sa),
      ntfOps: await get(srv, '/api/notifications?limit=200', ops),
      shares: await get(srv, '/api/share-links', sa),
      dashboards: await get(srv, '/api/dashboards', rt),
    });
    const before = await snapshot(s);
    const drivers = (srv: Server) => ({
      vehicleOf: [seedD, ctx.drivers.indexOf(nd.id)].map((d) => srv.ctx.drivers.vehicleOf(d)),
      driverOf: [seedVehicle, free[5]!, free[6]!, free[7]!].map((i) => srv.ctx.drivers.driverOf(i)),
      count: srv.ctx.drivers.count,
    });
    const driversBefore = drivers(s);
    const maxReq = Math.max(...ctx.requests.all.map((r) => Number(r.id.slice(4))));
    await s.close();

    s = await boot(path);
    const after = await snapshot(s);
    expect(after).toEqual(before);
    expect(drivers(s)).toEqual(driversBefore);
    expect((await s.api('GET', `/api/public/share/${live.token}`, { schema: ANY })).status).toBe(200);
    expect((await s.api('GET', `/api/public/share/${dead.token}`)).status).toBe(410);
    const socket = await s.ws({ cookie: sa });
    await new Promise((r) => setTimeout(r, 150));
    expect(socket.closeCode).toBeUndefined();
    socket.close();
    // No duplicate no-GPS episodes; the job raises nothing new at the same time.
    expect(
      s.ctx.db
        .prepare(
          "SELECT vehicle_id FROM notifications WHERE kind = 'no-gps-24h' GROUP BY vehicle_id, created_at HAVING COUNT(*) > 1",
        )
        .all(),
    ).toEqual([]);
    expect(s.ctx.notifications.tick()).toBe(0);
    // New ids continue after the stored ones.
    const next = await send<{ id: string }>(s, 'POST', '/api/requests', ndCookie, {
      type: 'rsa',
      note: 'after restart',
    });
    expect(next.id).toBe(`req-${maxReq + 1}`);
    const ids = s.ctx.db.prepare('SELECT COUNT(DISTINCT id) AS a, COUNT(*) AS b FROM notifications').get() as {
      a: number;
      b: number;
    };
    expect(ids.a).toBe(ids.b);
    await s.close();
  }, 30_000);
});

describe('F22-T4 sessions and tokens', () => {
  it('stores only hashes; logout, disable and reset delete rows; slides at most once a minute', async () => {
    const path = join(dir, 't4.db');
    let s = await boot(path);
    const sessions = () =>
      s.ctx.db.prepare('SELECT token_hash, user_id, expires_at FROM sessions').all() as {
        token_hash: string;
        user_id: string;
        expires_at: number;
      }[];
    const sa = await s.login(SEED_USERS.superadmin);
    const sid = sa.slice('fms_sid='.length);
    const row = sessions().find((r) => r.user_id === 'u-superadmin')!;
    expect(row.token_hash).toBe(hashToken(sid));
    expect(JSON.stringify(sessions())).not.toContain(sid);

    // Slide: +30 s → no write; +61 s → one write.
    const e0 = row.expires_at;
    s.ctx.clock.offsetMs = 30_000;
    await get(s, '/api/auth/me', sa);
    expect(sessions().find((r) => r.user_id === 'u-superadmin')!.expires_at).toBe(e0);
    s.ctx.clock.offsetMs = 61_000;
    await get(s, '/api/auth/me', sa);
    expect(sessions().find((r) => r.user_id === 'u-superadmin')!.expires_at).toBeGreaterThan(
      e0 + 60_000,
    );
    s.ctx.clock.offsetMs = 0;

    const ops = await s.login(SEED_USERS.ops);
    await send(s, 'POST', '/api/auth/logout', ops);
    expect(sessions().some((r) => r.user_id === 'u-ops')).toBe(false);

    await s.login(SEED_USERS.viewer);
    await send(s, 'PATCH', '/api/users/u-viewer', sa, { status: 'disabled' });
    expect(sessions().some((r) => r.user_id === 'u-viewer')).toBe(false);

    await s.login(SEED_USERS.driver);
    await s.api('POST', '/api/auth/forgot-password', { body: { email: SEED_USERS.driver.email } });
    const resetToken = await mailToken(s, SEED_USERS.driver.email);
    expect(JSON.stringify(s.ctx.db.prepare('SELECT * FROM reset_tokens').all())).not.toContain(
      resetToken,
    );
    const reset = await s.api('POST', '/api/auth/reset-password', {
      body: { token: resetToken, password: 'Newpass@123' },
    });
    expect(reset.status).toBe(204);
    expect(sessions().some((r) => r.user_id === 'u-driver')).toBe(false);

    // An expired row is purged at start.
    s.ctx.db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('old', 'u-ops', 1)")
      .run();
    await s.close();
    s = await boot(path);
    expect(sessions().map((r) => r.token_hash)).toEqual([hashToken(sid)]);
    expect((await s.api('GET', '/api/auth/me', { cookie: sa, schema: ANY })).status).toBe(200);
    const again = await s.api('POST', '/api/auth/reset-password', {
      body: { token: resetToken, password: 'Other@1234' },
    });
    expect(again.status).toBe(410);
    await s.login({ email: SEED_USERS.driver.email, password: 'Newpass@123' });
    await s.close();
  });
});

describe('F22-T5 dev reset', () => {
  it('POST /api/dev/reset wipes and re-seeds; sessions and sockets end; clock returns', async () => {
    const s = await startServer();
    const fresh = await startServer();
    const sa = await s.login(SEED_USERS.superadmin);
    await send(s, 'POST', '/api/roles', sa, { name: 'Gone', permissions: ['live.view'] });
    const f = await send<{ id: string }>(s, 'POST', '/api/fleets', sa, {
      parentId: s.ctx.tree.rootId,
      name: 'Gone',
    });
    await send(s, 'POST', `/api/fleets/${f.id}/vehicles`, sa, {
      vehicleIds: [s.ctx.sim.vehicleId(0), s.ctx.sim.vehicleId(1)],
    });
    await send(s, 'POST', '/api/share-links', sa, {
      vehicleId: s.ctx.sim.vehicleId(0),
      expiresAt: s.ctx.clock.now() + 3_600_000,
      show: { drivingEnergy: true, device: false },
      trail: { enabled: false, windowMinutes: 30 },
    });
    await send(s, 'POST', '/api/dashboards', sa, { title: 'Gone' });
    await send(s, 'POST', '/api/dev/clock', sa, { offsetMs: 3_600_000 });
    const socket = await s.ws({ cookie: sa });

    const started = performance.now();
    const res = await s.api('POST', '/api/dev/reset');
    const resetMs = performance.now() - started;
    expect(res.status).toBe(204);
    expect(await socket.waitClose()).toBe(4401);
    expect((await s.api('GET', '/api/auth/me', { cookie: sa })).status).toBe(401);
    expect(s.ctx.clock.offsetMs).toBe(0);
    process.stdout.write(`\n[F22-T5] dev reset (2000 vehicles): ${resetMs.toFixed(1)} ms`);

    const a = await s.login(SEED_USERS.superadmin);
    const b = await fresh.login(SEED_USERS.superadmin);
    for (const path of [
      '/api/roles',
      '/api/users',
      '/api/invites',
      '/api/fleets',
      '/api/drivers?limit=100',
      '/api/requests',
      '/api/share-links',
      '/api/dashboards',
    ])
      expect(await get(s, path, a), path).toEqual(await get(fresh, path, b));
    await s.close();
    await fresh.close();
  });

  it('is not registered in production', async () => {
    const app = buildServer({ vehicles: 200, dbPath: ':memory:', dev: false });
    const res = await app.inject({ method: 'POST', url: '/api/dev/reset' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
