// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { StatementSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../build-server.ts';
import type { MockContext } from '../context.ts';
import { atomic } from '../db/database.ts';
import { SEED_USERS } from '../testing/harness.ts';

/** F22-T7: spec §8 budgets at 1 lakh vehicles on a file database (in-process, `app.inject`). */
const dir = mkdtempSync(join(tmpdir(), 'fms-f22-perf-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const VEHICLES = 100_000;
const report = (name: string, value: string) => process.stdout.write(`\n[F22-T7] ${name}: ${value}`);
const ms = (n: number) => `${n.toFixed(1)} ms`;

async function boot(dbPath: string) {
  const t = performance.now();
  const app = buildServer({ vehicles: VEHICLES, dbPath });
  await app.ready();
  return { app, ms: performance.now() - t };
}
async function login(app: Awaited<ReturnType<typeof boot>>['app']) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: SEED_USERS.superadmin,
  });
  return res.cookies.find((c) => c.name === 'fms_sid')!.value;
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;

/** Spec §8 fixture, written through the store methods inside one transaction. */
function buildFixture(ctx: MockContext) {
  const { accounts, tree, sim, drivers, requests, notifications, shares, clock } = ctx;
  atomic(ctx.db, () => {
    const root = tree.rootId;
    for (let k = 0; k < 500; k++)
      accounts.addUser(`fx${k}@fms.local`, `Fixture ${k}`, 'Fixture@123', 'role-viewer', [root]);
    for (let k = 0; k < 500; k++)
      accounts.invite({ email: `inv${k}@fms.local`, roleId: 'role-viewer', fleetIds: [root] }, 'u-superadmin');
    for (let k = 0; k < 1000; k++) accounts.createSession('u-superadmin');
    const fleets: number[] = [];
    for (let k = 0; k < 300; k++) fleets.push(tree.create(root, `Fixture fleet ${k}`).idx);
    for (let i = 0; i < 10_000; i++) sim.moveTo(i * 7, fleets[i % fleets.length]!);
    for (let d = 0; d < 5000; d++) drivers.update(d * 3, { name: `Renamed ${d}` });
    // 20k assignments: spare drivers hop across free vehicles.
    const free: number[] = [];
    for (let i = 0; i < sim.count && free.length < 400; i++) if (drivers.driverOf(i) < 0) free.push(i);
    const spares: number[] = [];
    for (let d = drivers.gen.assignedCount; spares.length < 200; d++)
      if (drivers.status(d) !== 'disabled' && drivers.vehicleOf(d) < 0) spares.push(d);
    for (let k = 0; k < 20_000; k++) {
      const d = spares[k % spares.length]!;
      drivers.unassign(d);
      const i = free.find((v) => drivers.driverOf(v) < 0)!;
      drivers.assign(d, i, 'fixture');
      if (k % 2 === 0) drivers.unassign(d);
    }
    // 2k requests × ~4 events (breakdown + rsa per driver).
    let made = 0;
    for (let d = 0; made < 2000; d++) {
      if (drivers.vehicleOf(d) < 0 || drivers.byUserId('u-driver') === d) continue;
      const b = requests.create(d, { type: 'breakdown', reason: 'tyre', note: 'x' }, 'fx');
      requests.act(b, { action: 'acknowledge' }, 'u-superadmin', [root]);
      requests.act(b, { action: 'resolve' }, 'u-superadmin', [root]);
      const r = requests.create(d, { type: 'rsa', note: '' }, 'fx');
      requests.act(r, { action: 'acknowledge' }, 'u-superadmin', [root]);
      requests.act(r, { action: 'dispatch', assignee: 'A', etaMinutes: 5 }, 'u-superadmin', [root]);
      requests.act(r, { action: 'resolve' }, 'u-superadmin', [root]);
      made += 2;
    }
    const fleetId = tree.rootId;
    const added: string[] = [];
    while (notifications.size < 20_000)
      added.push(
        notifications.add(
          { kind: 'request-updated', severity: 'info', title: 't', body: 'b', fleetId },
          { fleetId, staff: ['live.view'], driver: -1 },
        ).id,
      );
    const sa = accounts.user('u-superadmin');
    const perms = accounts.permissions(sa);
    for (let k = 0; k < added.length; k += 2000)
      notifications.markRead(sa, perms, { ids: added.slice(k, k + 2000) });
    for (let k = 0; k < 1000; k++)
      shares.create(
        {
          vehicleId: sim.vehicleId(k),
          expiresAt: clock.now() + 86_400_000,
          show: { drivingEnergy: true, device: true },
          trail: { enabled: false, windowMinutes: 30 },
        },
        'u-superadmin',
      );
  });
}

describe('F22-T7 budgets (spec §8)', () => {
  it('start, reads, mutations, moves and reset', async () => {
    const path = join(dir, 'perf.db');
    const memory = await boot(':memory:');
    report('build + ready on :memory: (seed + first tick)', ms(memory.ms));
    await memory.app.close();

    const empty = await boot(path);
    report('build + ready on an empty file DB', ms(empty.ms));
    const { app } = empty;
    const ctx = app.mock;
    const t = performance.now();
    buildFixture(ctx);
    report('fixture build', ms(performance.now() - t));
    const counts = Object.fromEntries(
      ['users', 'invites', 'sessions', 'fleets', 'vehicle_fleet', 'driver_patches', 'assignments', 'requests', 'request_events', 'notifications', 'notification_reads', 'share_links'].map(
        (tb) => [tb, (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get() as { n: number }).n],
      ),
    );
    report('fixture rows', JSON.stringify(counts));
    await app.close();

    const full = await boot(path);
    report('build + ready on the full DB', ms(full.ms));
    const fctx = full.app.mock;
    const cookie = await login(full.app);
    const get = (url: string) =>
      full.app.inject({ method: 'GET', url, cookies: { fms_sid: cookie } });

    // Reads: no SQL at all.
    let statements = 0;
    const proto = StatementSync.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const originals = Object.fromEntries(['run', 'get', 'all', 'iterate'].map((k) => [k, proto[k]!]));
    for (const k of Object.keys(originals))
      proto[k] = function (this: unknown, ...a: unknown[]) {
        statements++;
        return originals[k]!.apply(this, a);
      };
    try {
      for (const url of ['/api/auth/me', '/api/fleets', '/api/users', '/api/invites', '/api/roles', '/api/notifications?limit=50', '/api/requests', '/api/drivers?limit=50', '/api/share-links'])
        expect((await get(url)).statusCode, url).toBe(200);
    } finally {
      Object.assign(proto, originals);
    }
    report('SQL statements during 9 read requests', String(statements));
    expect(statements).toBe(0);

    // Single mutations (store level, p95 of 50 each).
    const time = (fn: (k: number) => unknown) => {
      const xs: number[] = [];
      for (let k = 0; k < 50; k++) {
        const s = performance.now();
        fn(k);
        xs.push(performance.now() - s);
      }
      return p95(xs);
    };
    const root = fctx.tree.rootId;
    const role = fctx.accounts.addRole({ id: 'role-perf', name: 'P', permissions: ['live.view'], system: false });
    const spare = (() => {
      let d = fctx.drivers.gen.assignedCount + 500;
      while (fctx.drivers.status(d) === 'disabled' || fctx.drivers.vehicleOf(d) >= 0) d++;
      return d;
    })();
    const freeV: number[] = [];
    for (let i = sim0(fctx); freeV.length < 60; i++) if (fctx.drivers.driverOf(i) < 0) freeV.push(i);
    const results = {
      invite: time((k) =>
        fctx.accounts.invite({ email: `p95-${k}@fms.local`, roleId: 'role-viewer', fleetIds: [root] }, 'u-superadmin'),
      ),
      roleEdit: time((k) => fctx.accounts.updateRole(role.id, { name: `P${k}` })),
      assign: time((k) => fctx.drivers.assign(spare, freeV[k]!, 'perf')),
      requestAct: time(() => {
        const d = fctx.drivers.vehicleOf(spare) >= 0 ? spare : -1;
        const r = fctx.requests.create(d, { type: 'rsa', note: '' }, 'perf');
        fctx.requests.act(r, { action: 'acknowledge' }, 'u-superadmin', [root]);
        fctx.requests.act(r, { action: 'dispatch', assignee: 'A', etaMinutes: 5 }, 'u-superadmin', [root]);
        fctx.requests.act(r, { action: 'close' }, 'u-superadmin', [root]);
      }),
      shareCreate: time((k) =>
        fctx.shares.create(
          {
            vehicleId: fctx.sim.vehicleId(k),
            expiresAt: fctx.clock.now() + 60_000,
            show: { drivingEnergy: true, device: true },
            trail: { enabled: false, windowMinutes: 30 },
          },
          'u-superadmin',
        ),
      ),
    };
    report('mutation p95 (create + 3 acts for requestAct)', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, +v.toFixed(2)]))));

    // Move of 1,000 vehicles in one request.
    const target = fctx.tree.create(root, 'Perf target');
    const ids = Array.from({ length: 1000 }, (_, k) => fctx.sim.vehicleId(50_000 + k));
    const m0 = performance.now();
    const moved = await full.app.inject({
      method: 'POST',
      url: `/api/fleets/${target.id}/vehicles`,
      cookies: { fms_sid: cookie },
      payload: { vehicleIds: ids },
    });
    expect(moved.statusCode).toBe(200);
    report('move 1,000 vehicles (request)', ms(performance.now() - m0));

    const r0 = performance.now();
    const reset = await full.app.inject({ method: 'POST', url: '/api/dev/reset' });
    expect(reset.statusCode).toBe(204);
    const resetMs = performance.now() - r0;
    report('dev reset (full DB → seed)', ms(resetMs));
    await full.app.close();

    // Asserted gates (×2 margin under load): starts and reset.
    expect(empty.ms).toBeLessThanOrEqual(3000);
    expect(full.ms).toBeLessThanOrEqual(3000);
    expect(resetMs).toBeLessThanOrEqual(2000);
  }, 180_000);
});

/** First vehicle index to scan for free vehicles (away from the fixture's range). */
const sim0 = (ctx: MockContext) => Math.floor(ctx.sim.count / 2) + 5000;
