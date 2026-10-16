// @vitest-environment node
import {
  actionCardSchema,
  AUDIT_CSV_HEADER,
  auditPageSchema,
  fleetSchema,
  type ActionKind,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROPOSAL_TTL_MS } from '../store/assistant-actions.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F29-T1…T3 (relaxed): propose / confirm / stale / expiry / permission, Undo, audit gating. */

let srv: Awaited<ReturnType<typeof startServer>>;
let admin: string;
let ops: string;

beforeAll(async () => {
  srv = await startServer();
  admin = await srv.login(SEED_USERS.superadmin);
  ops = await srv.login(SEED_USERS.ops);
});
afterAll(() => srv.close());

const userOf = (email: string) => srv.ctx.accounts.userByEmail(email)!;
const propose = (email: string, kind: ActionKind, params: unknown) =>
  srv.ctx.actions.propose(userOf(email), { kind, params, threadId: 'thr-test' });
const post = (path: string, cookie: string) =>
  srv.api('POST', path, { cookie, schema: actionCardSchema });

/** A free vehicle and an active driver without one, both in North (ops scope too). */
function freePair() {
  const { drivers, sim, tree } = srv.ctx;
  const north = [...tree.byId.values()].find((f) => f.name === 'North')!;
  let d = -1;
  for (let k = 0; k < drivers.count && d < 0; k++)
    if (drivers.vehicleOf(k) < 0 && drivers.status(k) === 'active') d = k;
  let i = -1;
  for (let k = 0; k < sim.count && i < 0; k++)
    if (drivers.driverOf(k) < 0 && tree.isDescendant(sim.fleet[k]!, north.idx)) i = k;
  return { d, i, driverId: drivers.get(d).id, regno: sim.regno(i) };
}

/** A leaf fleet (no children) under North. */
function leafFleet(skip: string[] = []) {
  const { tree } = srv.ctx;
  return tree.nodes.find(
    (n) => n && n.depth > 2 && !skip.includes(n.id) && !tree.nodes.some((c) => c?.parent === n.idx),
  )!;
}

describe('F29-T1 propose → confirm', () => {
  it.each<
    [string, () => { kind: ActionKind; params: unknown; check: () => void; unchanged: () => void }]
  >([
    [
      'driver.assign',
      () => {
        const p = freePair();
        return {
          kind: 'driver.assign',
          params: { driver: p.driverId, vehicle: p.regno },
          unchanged: () => expect(srv.ctx.drivers.vehicleOf(p.d)).toBe(-1),
          check: () => expect(srv.ctx.drivers.vehicleOf(p.d)).toBe(p.i),
        };
      },
    ],
    [
      'fleet.rename',
      () => {
        const f = leafFleet();
        const from = f.name;
        return {
          kind: 'fleet.rename',
          params: { fleet: f.id, name: `${from} X` },
          unchanged: () => expect(f.name).toBe(from),
          check: () => expect(f.name).toBe(`${from} X`),
        };
      },
    ],
    [
      'vehicles.move',
      () => {
        const { sim } = srv.ctx;
        const target = leafFleet();
        const ids = [0, 1, 2]
          .filter((i) => sim.fleet[i] !== target.idx)
          .map((i) => sim.vehicleId(i));
        const before = ids.map((id) => sim.fleetId(sim.indexOf(id)));
        return {
          kind: 'vehicles.move',
          params: { vehicles: ids, fleet: target.id },
          unchanged: () => expect(ids.map((id) => sim.fleetId(sim.indexOf(id)))).toEqual(before),
          check: () =>
            expect(ids.every((id) => sim.fleetId(sim.indexOf(id)) === target.id)).toBe(true),
        };
      },
    ],
    [
      'share_link.create',
      () => {
        const live = () => [...srv.ctx.shares.links.values()].filter((l) => !l.revokedAt).length;
        const n = live();
        return {
          kind: 'share_link.create',
          params: { vehicle: srv.ctx.sim.regno(5), expiresInHours: 2 },
          // Undo revokes the link.
          unchanged: () => expect(live()).toBe(n),
          check: () => expect(live()).toBe(n + 1),
        };
      },
    ],
  ])('%s: propose changes nothing; confirm applies, audits and can be undone', async (_k, make) => {
    const c = make();
    const card = propose(SEED_USERS.superadmin.email, c.kind, c.params);
    expect(card.status).toBe('proposed');
    expect(card.rows.length).toBeGreaterThan(0);
    c.unchanged();
    const done = await post(`/api/actions/${card.id}/confirm`, admin);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
    expect(done.body.canUndo).toBe(true);
    c.check();
    // single use
    expect((await post(`/api/actions/${card.id}/confirm`, admin)).status).toBe(409);
    const undone = await post(`/api/actions/${card.id}/undo`, admin);
    expect(undone.status).toBe(200);
    expect(undone.body.status).toBe('undone');
    c.unchanged();
    expect((await post(`/api/actions/${card.id}/undo`, admin)).status).toBe(409);
  });

  it('share_link.create returns the link URL', async () => {
    const card = propose(SEED_USERS.superadmin.email, 'share_link.create', {
      vehicle: srv.ctx.sim.regno(6),
    });
    const done = await post(`/api/actions/${card.id}/confirm`, admin);
    expect(done.body.result).toMatch(/\/share\//);
  });

  it('refuses without permission at propose (403) and on confirm after it is removed', async () => {
    expect(() =>
      propose(SEED_USERS.viewer.email, 'fleet.rename', { fleet: 'North', name: 'N' }),
    ).toThrow(/fleets.manage/);
    const card = propose(SEED_USERS.ops.email, 'share_link.create', { vehicle: freePair().regno });
    const role = srv.ctx.accounts.role('role-operator');
    const perms = [...role.permissions];
    srv.ctx.accounts.updateRole(role.id, {
      permissions: perms.filter((p) => p !== 'share.create'),
    });
    try {
      expect((await post(`/api/actions/${card.id}/confirm`, ops)).status).toBe(403);
    } finally {
      srv.ctx.accounts.updateRole(role.id, { permissions: perms });
    }
  });

  it('only the proposer can confirm (404 for others)', async () => {
    const card = propose(SEED_USERS.superadmin.email, 'notifications.read', { all: true });
    expect((await post(`/api/actions/${card.id}/confirm`, ops)).status).toBe(404);
    expect((await post(`/api/actions/${card.id}/cancel`, admin)).body.status).toBe('cancelled');
  });

  it('stale: the target changed since the proposal → 409 action_stale', async () => {
    const f = leafFleet();
    const card = propose(SEED_USERS.superadmin.email, 'fleet.rename', {
      fleet: f.id,
      name: 'Stale A',
    });
    const patch = await srv.api('PATCH', `/api/fleets/${f.id}`, {
      cookie: admin,
      body: { name: 'Changed meanwhile' },
      schema: fleetSchema,
    });
    expect(patch.status).toBe(200);
    const res = await post(`/api/actions/${card.id}/confirm`, admin);
    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe('action_stale');
  });

  it('expired after 10 minutes → 409 action_expired', async () => {
    const card = propose(SEED_USERS.superadmin.email, 'notifications.read', { all: true });
    srv.ctx.clock.offsetMs += PROPOSAL_TTL_MS + 1000;
    try {
      const res = await post(`/api/actions/${card.id}/confirm`, admin);
      expect(res.status).toBe(409);
      expect((res.body as unknown as { error: { code: string } }).error.code).toBe(
        'action_expired',
      );
    } finally {
      srv.ctx.clock.offsetMs -= PROPOSAL_TTL_MS + 1000;
    }
  });
});

describe('F29-T2 undo', () => {
  it('is refused once the target changed', async () => {
    const f = leafFleet();
    const card = propose(SEED_USERS.superadmin.email, 'fleet.rename', {
      fleet: f.id,
      name: 'Undo A',
    });
    await post(`/api/actions/${card.id}/confirm`, admin);
    srv.ctx.tree.update(f.id, { name: 'Undo B' });
    const res = await post(`/api/actions/${card.id}/undo`, admin);
    expect(res.status).toBe(409);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe('not_undoable');
  });

  it('driver.assign undo restores the previous assignment and is audited', async () => {
    const p = freePair();
    const card = propose(SEED_USERS.superadmin.email, 'driver.assign', {
      driver: p.driverId,
      vehicle: p.regno,
    });
    await post(`/api/actions/${card.id}/confirm`, admin);
    await post(`/api/actions/${card.id}/undo`, admin);
    expect(srv.ctx.drivers.vehicleOf(p.d)).toBe(-1);
    const page = await srv.api('GET', '/api/audit?kind=driver.assign', {
      cookie: admin,
      schema: auditPageSchema,
    });
    const mine = page.body.items.filter((e) => e.actionId === card.id);
    expect(mine.map((e) => e.status).sort()).toEqual(['undo', 'undone']);
    expect(mine.every((e) => e.threadId === 'thr-test')).toBe(true);
  });
});

describe('F29-T3 audit', () => {
  it('is gated by audit.view; filters; CSV header', async () => {
    expect((await srv.api('GET', '/api/audit', { cookie: ops })).status).toBe(403);
    const all = await srv.api('GET', '/api/audit', { cookie: admin, schema: auditPageSchema });
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(0);
    const fleets = await srv.api('GET', '/api/audit?area=fleets', {
      cookie: admin,
      schema: auditPageSchema,
    });
    expect(fleets.body.items.every((e) => e.area === 'fleets')).toBe(true);
    const q = await srv.api('GET', '/api/audit?q=undo%20a', {
      cookie: admin,
      schema: auditPageSchema,
    });
    expect(q.body.items.length).toBeGreaterThan(0);
    const csv = await fetch(`${srv.base}/api/audit.csv?area=fleets`, {
      headers: { cookie: admin },
    });
    expect(csv.status).toBe(200);
    expect((await csv.text()).split('\n')[0]).toBe(AUDIT_CSV_HEADER.join(','));
  });
});
