// @vitest-environment node
import {
  analyticsSummarySchema,
  dashboardListSchema,
  dashboardSchema,
  dashboardShareListSchema,
  dashboardThreadSchema,
  roleSchema,
  shareCandidateListSchema,
  userSchema,
  vehicleRankingSchema,
  type Dashboard,
  type WidgetInput,
} from '@shared/contract/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../http-error.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

type Server = Awaited<ReturnType<typeof startServer>>;
let server: Server;
let ops: string;
let admin: string;
let viewer: string;

const OPS_ID = 'u-ops';
const ADMIN_ID = 'u-superadmin';
const timings: Record<string, number[]> = {};
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;

const kpi = (title = 'Distance'): WidgetInput => ({
  type: 'kpi',
  title,
  source: 'analytics',
  metric: 'distanceKm',
  range: '7d',
});
const ranking: WidgetInput = {
  type: 'ranking',
  title: 'Top idle',
  entity: 'vehicles',
  metric: 'idleMs',
  order: 'desc',
  limit: 10,
  range: '7d',
};
const note = (body = 'Notes'): WidgetInput => ({ type: 'text', title: 'Note', body });
const code = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;

/** Calls the API and records the latency per label (budget §9). */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const res = await fn();
  (timings[label] ??= []).push(performance.now() - t);
  return res;
}

beforeAll(async () => {
  server = await startServer();
  [ops, admin, viewer] = await Promise.all([
    server.login(SEED_USERS.ops),
    server.login(SEED_USERS.superadmin),
    server.login(SEED_USERS.viewer),
  ]);
});
afterAll(async () => {
  await server.close();
  const report = Object.entries(timings).map(
    ([k, xs]) => `${k}: p95 ${p95(xs).toFixed(2)} ms (n=${xs.length})`,
  );
  console.info(`[F18 budgets]\n${report.join('\n')}`);
});

const create = (cookie: string, body: object = {}) =>
  timed('POST /dashboards', () =>
    server.api('POST', '/api/dashboards', { cookie, body, schema: dashboardSchema }),
  );

describe('F18-T3: CRUD as ops', () => {
  it('create, list, get, patch, duplicate, delete', async () => {
    const { api } = server;
    const created = await create(ops, { title: 'Ops board', widgets: [kpi(), ranking, note()] });
    expect(created.status).toBe(201);
    const d = created.body;
    expect(d).toMatchObject({ version: 1, access: 'owner', ownerName: 'Ops User' });
    expect(d.widgets.map((w) => w.id).every((id) => /^w-/.test(id))).toBe(true);
    for (const bp of ['lg', 'md', 'sm'] as const) {
      expect(d.layout[bp].map((i) => i.i).sort()).toEqual(d.widgets.map((w) => w.id).sort());
    }
    expect(d.layout.sm.every((i) => i.w === 1 && i.x === 0)).toBe(true);
    // D-162: created in one go → organised: small tiles share the top row (stretched), then the list.
    expect(d.layout.lg.map((i) => [i.x, i.y, i.w, i.h])).toEqual([
      [0, 0, 6, 2],
      [6, 0, 6, 2],
      [0, 2, 12, 5],
    ]);

    const list = await timed('GET /dashboards', () =>
      api('GET', '/api/dashboards', { cookie: ops, schema: dashboardListSchema }),
    );
    expect(list.body.mine.find((s) => s.id === d.id)).toMatchObject({
      widgetCount: 3,
      shareCount: 0,
    });
    const got = await api('GET', `/api/dashboards/${d.id}`, {
      cookie: ops,
      schema: dashboardSchema,
    });
    expect(got.body).toEqual(d);

    // An explicit layout must only reference the new widgets; missing ones are appended.
    const lg = d.layout.lg
      .filter((i) => i.i !== d.widgets[1]!.id)
      .map((i) => (i.i === d.widgets[2]!.id ? { ...i, x: 6, y: 9 } : i));
    const keep = (items: typeof lg) => items.filter((i) => i.i !== d.widgets[1]!.id);
    const patched = await timed('PATCH /dashboards/:id', () =>
      api('PATCH', `/api/dashboards/${d.id}`, {
        cookie: ops,
        body: {
          version: 1,
          title: 'Renamed',
          widgets: [d.widgets[0], d.widgets[2], kpi('Added')],
          layout: { lg, md: keep(d.layout.md), sm: keep(d.layout.sm) },
        },
        schema: dashboardSchema,
      }),
    );
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ version: 2, title: 'Renamed' });
    expect(patched.body.widgets).toHaveLength(3);
    expect(patched.body.layout.lg.find((i) => i.i === d.widgets[2]!.id)).toMatchObject({
      x: 6,
      y: 9,
    });
    expect(patched.body.layout.lg.some((i) => i.i === d.widgets[1]!.id)).toBe(false);
    expect(patched.body.layout.md).toHaveLength(3);

    const dup = await api('POST', `/api/dashboards/${d.id}/duplicate`, {
      cookie: ops,
      body: {},
      schema: dashboardSchema,
    });
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ version: 1, title: 'Renamed (copy)', ownerId: OPS_ID });
    expect(dup.body.id).not.toBe(d.id);
    expect(dup.body.widgets).toEqual(patched.body.widgets);
    const dupThread = await api('GET', `/api/dashboards/${dup.body.id}/thread`, {
      cookie: ops,
      schema: dashboardThreadSchema,
    });
    expect(dupThread.body.messages).toEqual([]);

    expect((await api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops })).status).toBe(204);
    expect((await api('GET', `/api/dashboards/${d.id}`, { cookie: ops })).status).toBe(404);
    await api('DELETE', `/api/dashboards/${dup.body.id}`, { cookie: ops });
  });

  it('an explicit layout must reference the widgets; owner writes need widget permissions', async () => {
    const d = (await create(ops, { widgets: [kpi()] })).body;
    const bad = await server.api('PATCH', `/api/dashboards/${d.id}`, {
      cookie: ops,
      body: {
        version: 1,
        layout: { lg: [{ i: 'w-ghost', x: 0, y: 0, w: 2, h: 2 }], md: [], sm: [] },
      },
    });
    expect(bad.status).toBe(422);
    const driverList: WidgetInput = { type: 'driver-list', title: 'Drivers', limit: 5 };
    const denied = await server.api('PATCH', `/api/dashboards/${d.id}`, {
      cookie: ops,
      body: { version: 1, widgets: [...d.widgets, driverList] },
    });
    expect(denied.status).toBe(422);
    expect(code(denied)).toBe('widget_not_permitted');
    await server.api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
  });
});

describe('F18-T4: optimistic concurrency', () => {
  it('second patch based on v1 → 409 version_conflict, nothing overwritten', async () => {
    const d = (await create(ops, { title: 'Race' })).body;
    const patch = (title: string) =>
      server.api('PATCH', `/api/dashboards/${d.id}`, {
        cookie: ops,
        body: { version: 1, title },
        schema: dashboardSchema,
      });
    const first = await patch('First');
    const second = await patch('Second');
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: { code: 'version_conflict', details: { currentVersion: 2 } },
    });
    const got = await server.api('GET', `/api/dashboards/${d.id}`, {
      cookie: ops,
      schema: dashboardSchema,
    });
    expect(got.body).toMatchObject({ title: 'First', version: 2 });
    await server.api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
  });
});

describe('F18-T5: 50 owned dashboards (+ budgets with 24 widgets each)', () => {
  it('the 51st → 409 dashboard_limit; shared-with-me does not count', async () => {
    const { api } = server;
    const shared = (await create(ops, { title: 'From ops' })).body;
    await api('POST', `/api/dashboards/${shared.id}/shares`, {
      cookie: ops,
      body: { userIds: [ADMIN_ID] },
      schema: dashboardShareListSchema,
    });
    const widgets = Array.from({ length: 24 }, (_, n) => (n % 2 ? kpi(`K${n}`) : note(`N${n}`)));
    const ids: string[] = [];
    for (let n = 0; n < 50; n++) {
      const res = await create(admin, { title: `Board ${n}`, widgets });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    const over = await api('POST', '/api/dashboards', { cookie: admin, body: {} });
    expect(over.status).toBe(409);
    expect(code(over)).toBe('dashboard_limit');
    const dupOver = await api('POST', `/api/dashboards/${shared.id}/duplicate`, {
      cookie: admin,
      body: {},
    });
    expect(code(dupOver)).toBe('dashboard_limit');

    // Budget: every endpoint ≤ 20 ms p95 with 50 × 24 widgets for one user.
    let current: Dashboard | undefined;
    for (let n = 0; n < 40; n++) {
      const list = await timed('GET /dashboards (50×24)', () =>
        api('GET', '/api/dashboards', { cookie: admin, schema: dashboardListSchema }),
      );
      expect(list.body.mine).toHaveLength(50);
      expect(list.body.sharedWithMe.map((s) => s.id)).toEqual([shared.id]);
      current = (
        await timed('GET /dashboards/:id (24 widgets)', () =>
          api('GET', `/api/dashboards/${ids[n]}`, { cookie: admin, schema: dashboardSchema }),
        )
      ).body;
      await timed('PATCH /dashboards/:id (24 widgets)', () =>
        api('PATCH', `/api/dashboards/${ids[n]}`, {
          cookie: admin,
          body: { version: current!.version, widgets: current!.widgets, layout: current!.layout },
          schema: dashboardSchema,
        }),
      );
    }
    for (const id of ids) await api('DELETE', `/api/dashboards/${id}`, { cookie: admin });
    await api('DELETE', `/api/dashboards/${shared.id}`, { cookie: ops });
  });
});

describe('F18-T6: sharing', () => {
  it('candidates, viewer access, owner-only writes, duplicate, revoke', async () => {
    const { api, ctx } = server;
    const disabled = ctx.accounts.addUser(
      'off@fms.local',
      'Off Ops',
      'Off@12345',
      'role-operator',
      [ctx.tree.rootId],
    );
    ctx.accounts.user(disabled.id).status = 'disabled';
    const cands = await api('GET', '/api/dashboards/share-candidates', {
      cookie: ops,
      schema: shareCandidateListSchema,
    });
    const ids = cands.body.map((c) => c.userId);
    expect(ids).toContain(ADMIN_ID);
    expect(ids).not.toContain(OPS_ID);
    expect(ids).not.toContain('u-viewer');
    expect(ids).not.toContain(disabled.id);
    expect(Object.keys(cands.body[0]!).sort()).toEqual(['email', 'name', 'userId']);
    const q = await api('GET', '/api/dashboards/share-candidates?q=SUPER', {
      cookie: ops,
      schema: shareCandidateListSchema,
    });
    expect(q.body.map((c) => c.userId)).toEqual([ADMIN_ID]);
    const adminCands = await api('GET', '/api/dashboards/share-candidates', {
      cookie: admin,
      schema: shareCandidateListSchema,
    });
    expect(adminCands.body.map((c) => c.userId)).toContain(OPS_ID);

    const d = (await create(ops, { title: 'Shared', widgets: [kpi()] })).body;
    const nonCandidate = await api('POST', `/api/dashboards/${d.id}/shares`, {
      cookie: ops,
      body: { userIds: ['u-viewer'] },
    });
    expect(nonCandidate.status).toBe(422);
    expect(nonCandidate.body).toMatchObject({
      error: { details: [{ userId: 'u-viewer', reason: 'not_a_candidate' }] },
    });
    const self = await api('POST', `/api/dashboards/${d.id}/shares`, {
      cookie: ops,
      body: { userIds: [OPS_ID] },
    });
    expect(self.status).toBe(422);
    for (let n = 0; n < 2; n++) {
      const add = await api('POST', `/api/dashboards/${d.id}/shares`, {
        cookie: ops,
        body: { userIds: [ADMIN_ID] },
        schema: dashboardShareListSchema,
      });
      expect(add.body.map((s) => s.userId)).toEqual([ADMIN_ID]); // idempotent
    }
    const adminList = await api('GET', '/api/dashboards', {
      cookie: admin,
      schema: dashboardListSchema,
    });
    expect(adminList.body.sharedWithMe.find((s) => s.id === d.id)).toMatchObject({
      access: 'viewer',
      shareCount: 0,
      ownerName: 'Ops User',
    });
    const opsList = await api('GET', '/api/dashboards', {
      cookie: ops,
      schema: dashboardListSchema,
    });
    expect(opsList.body.mine.find((s) => s.id === d.id)?.shareCount).toBe(1);
    const got = await api('GET', `/api/dashboards/${d.id}`, {
      cookie: admin,
      schema: dashboardSchema,
    });
    expect(got.body.access).toBe('viewer');
    expect(got.body.version).toBe(1); // sharing doesn't bump the version

    const ownerOnly: [string, string, object?][] = [
      ['PATCH', `/api/dashboards/${d.id}`, { version: 1, title: 'x' }],
      ['DELETE', `/api/dashboards/${d.id}`],
      ['GET', `/api/dashboards/${d.id}/shares`],
      ['POST', `/api/dashboards/${d.id}/shares`, { userIds: [OPS_ID] }],
      ['DELETE', `/api/dashboards/${d.id}/shares/${ADMIN_ID}`],
      ['GET', `/api/dashboards/${d.id}/thread`],
      ['POST', `/api/dashboards/${d.id}/changes/chg-x/undo`, { version: 1 }],
    ];
    for (const [method, path, body] of ownerOnly) {
      const res = await api(method, path, { cookie: admin, body });
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    const dup = await api('POST', `/api/dashboards/${d.id}/duplicate`, {
      cookie: admin,
      body: { title: 'Mine now' },
      schema: dashboardSchema,
    });
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ ownerId: ADMIN_ID, access: 'owner', title: 'Mine now' });

    expect(
      (await api('DELETE', `/api/dashboards/${d.id}/shares/${ADMIN_ID}`, { cookie: ops })).status,
    ).toBe(204);
    expect((await api('GET', `/api/dashboards/${d.id}`, { cookie: admin })).status).toBe(404);
    // Someone it was never shared with: 404 (existence not leaked), not 403.
    expect((await api('GET', `/api/dashboards/${dup.body.id}`, { cookie: ops })).status).toBe(404);
    expect(
      (
        await api('PATCH', `/api/dashboards/${dup.body.id}`, {
          cookie: ops,
          body: { version: 1, title: 'x' },
        })
      ).status,
    ).toBe(404);
    await api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
    await api('DELETE', `/api/dashboards/${dup.body.id}`, { cookie: admin });
  });
});

describe('F18-T7: widget data is fetched as the viewer (fewer fleets)', () => {
  it('a North sub-fleet user sees only their subtree; a sibling fleet → 403', async () => {
    const { api, ctx } = server;
    const fleets = [...ctx.tree.byId.values()];
    const north = fleets.find((f) => f.name === 'North')!;
    const children = fleets.filter((f) => f.parent === north.idx);
    const [sub, sibling] = children;
    expect(sibling).toBeDefined();
    const role = await api('POST', '/api/roles', {
      cookie: admin,
      body: { name: 'Dash analyst', permissions: ['dashboards.use', 'analytics.view'] },
      schema: roleSchema,
    });
    const u = ctx.accounts.addUser('analyst@fms.local', 'Analyst', 'Analyst@123', 'role-viewer', [
      north.id,
    ]);
    await api('PATCH', `/api/users/${u.id}`, {
      cookie: admin,
      body: { roleId: role.body.id, fleetIds: [sub!.id] },
      schema: userSchema,
    });
    const analyst = await server.login({ email: 'analyst@fms.local', password: 'Analyst@123' });

    const widgets: WidgetInput[] = [
      { type: 'kpi', title: 'Vehicles', source: 'analytics', metric: 'vehicleCount', range: '7d' },
      ranking,
      {
        type: 'kpi',
        title: 'Sibling',
        source: 'analytics',
        metric: 'distanceKm',
        range: '7d',
        fleetId: sibling!.id,
      },
    ];
    const d = (await create(ops, { title: 'Scoped', widgets })).body;
    const share = await api('POST', `/api/dashboards/${d.id}/shares`, {
      cookie: ops,
      body: { userIds: [u.id] },
      schema: dashboardShareListSchema,
    });
    expect(share.status).toBe(200);
    const seen = await api('GET', `/api/dashboards/${d.id}`, {
      cookie: analyst,
      schema: dashboardSchema,
    });
    expect(seen.body.widgets).toHaveLength(3);

    // The documented endpoints, called as each viewer (`to`/`from` omitted = last 30 days).
    const mask = ctx.tree.scopeMask([sub!.id]);
    let inSub = 0;
    for (let i = 0; i < ctx.config.vehicles; i++) if (mask[ctx.sim.fleet[i]!] === 1) inSub++;
    const mine = await api('GET', '/api/analytics/summary', {
      cookie: analyst,
      schema: analyticsSummarySchema,
    });
    const theirs = await api('GET', '/api/analytics/summary', {
      cookie: ops,
      schema: analyticsSummarySchema,
    });
    expect(mine.body.vehicleCount).toBe(inSub);
    expect(theirs.body.vehicleCount).toBeGreaterThan(inSub);
    const rank = await api('GET', '/api/analytics/vehicles?sort=idleMs&limit=10', {
      cookie: analyst,
      schema: vehicleRankingSchema,
    });
    expect(rank.body.items.length).toBeGreaterThan(0);
    expect(rank.body.items.every((it) => ctx.tree.inScope(it.fleetId, [sub!.id]))).toBe(true);
    const sib = `/api/analytics/summary?fleetId=${sibling!.id}`;
    expect((await api('GET', sib, { cookie: analyst })).status).toBe(403);
    expect((await api('GET', sib, { cookie: ops, schema: analyticsSummarySchema })).status).toBe(
      200,
    );
    await api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
  });
});

describe('F18-T8: validation and auth', () => {
  it('rejects non-catalogue widgets with the path; nothing is stored', async () => {
    const { api } = server;
    const before = (
      await api('GET', '/api/dashboards', { cookie: ops, schema: dashboardListSchema })
    ).body.mine.length;
    const iframe = await api('POST', '/api/dashboards', {
      cookie: ops,
      body: { widgets: [{ type: 'iframe', title: 'x', src: 'https://x' }] },
    });
    expect(iframe.status).toBe(422);
    expect(code(iframe)).toBe('validation_failed');
    const paths = (iframe.body as { error: { details: { path: unknown[] }[] } }).error.details.map(
      (i) => i.path.join('.'),
    );
    expect(paths).toContain('widgets.0.type');
    const html = await api('POST', '/api/dashboards', {
      cookie: ops,
      body: { widgets: [{ type: 'text', title: 'x', body: 'hi', html: '<script>' }] },
    });
    expect(html.status).toBe(422);
    const d = (await create(ops, { widgets: [note()] })).body;
    const patch = await api('PATCH', `/api/dashboards/${d.id}`, {
      cookie: ops,
      body: { version: 1, widgets: [{ ...d.widgets[0], html: '<b>' }] },
    });
    expect(patch.status).toBe(422);
    const after = await api('GET', `/api/dashboards/${d.id}`, {
      cookie: ops,
      schema: dashboardSchema,
    });
    expect(after.body.version).toBe(1);
    const list = await api('GET', '/api/dashboards', { cookie: ops, schema: dashboardListSchema });
    expect(list.body.mine.length).toBe(before + 1);
    await api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
  });

  it('without dashboards.use → 403 everywhere; signed out → 401', async () => {
    const d = (await create(ops)).body;
    const routes: [string, string, object?][] = [
      ['GET', '/api/dashboards'],
      ['POST', '/api/dashboards', {}],
      ['GET', '/api/dashboards/share-candidates'],
      ['GET', `/api/dashboards/${d.id}`],
      ['PATCH', `/api/dashboards/${d.id}`, { version: 1, title: 'x' }],
      ['POST', `/api/dashboards/${d.id}/duplicate`, {}],
      ['DELETE', `/api/dashboards/${d.id}`],
      ['GET', `/api/dashboards/${d.id}/shares`],
      ['POST', `/api/dashboards/${d.id}/shares`, { userIds: [ADMIN_ID] }],
      ['DELETE', `/api/dashboards/${d.id}/shares/${ADMIN_ID}`],
      ['GET', `/api/dashboards/${d.id}/thread`],
      ['POST', `/api/dashboards/${d.id}/changes/chg-x/undo`, { version: 1 }],
    ];
    for (const [method, path, body] of routes) {
      const v = await server.api(method, path, { cookie: viewer, body });
      const anon = await server.api(method, path, { body });
      expect([path, v.status, anon.status]).toEqual([path, 403, 401]);
    }
    await server.api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops });
  });
});

describe('F18-T9: thread, change sets and undo (store)', () => {
  it('append, applyTurn, undo, not_undoable cases, cascade', async () => {
    const store = server.ctx.dashboards;
    const d = store.create(OPS_ID, { title: 'Chat board', widgets: [note('one')] });
    const m1 = store.appendMessage(OPS_ID, d.id, { role: 'user', text: 'add a kpi' });
    const turn = store.applyTurn(OPS_ID, d.id, 1, 'Added 1 widget, renamed dashboard', (draft) => {
      draft.widgets.push(kpi('Fresh'));
      draft.title = 'Chat board v2';
    });
    expect(turn.dashboard).toMatchObject({ version: 2, title: 'Chat board v2' });
    expect(turn.dashboard.layout.lg).toHaveLength(2);
    expect(turn.change).toMatchObject({ beforeVersion: 1, afterVersion: 2, undoable: true });
    const m2 = store.appendMessage(OPS_ID, d.id, {
      role: 'assistant',
      text: 'Done',
      chips: [{ tool: 'add_widget', label: 'Added widget: Fresh', status: 'ok' }],
      changeId: turn.change.id,
    });
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    expect(m2.change?.undoable).toBe(true);
    expect(() =>
      store.applyTurn(OPS_ID, d.id, 1, 'stale', (draft) => void (draft.title = 'x')),
    ).toThrow(expect.objectContaining({ code: 'version_conflict' }));
    expect(() =>
      store.applyTurn(OPS_ID, d.id, 2, 'bad', (draft) => {
        draft.widgets.push({ type: 'iframe' } as unknown as WidgetInput);
      }),
    ).toThrow(HttpError);
    expect(store.get(OPS_ID, d.id).version).toBe(2); // rolled back

    // Undo restores the previous content as v3 and marks the change set undone.
    const undone = store.undo(OPS_ID, d.id, turn.change.id, 2);
    expect(undone).toMatchObject({ version: 3, title: 'Chat board' });
    expect(undone.widgets.map((w) => w.id)).toEqual(d.widgets.map((w) => w.id));
    expect(undone.layout).toEqual(d.layout);
    const thread = store.thread(OPS_ID, d.id);
    expect(thread.messages[1]!.change).toMatchObject({ undoable: false });
    expect(thread.messages[1]!.change!.undoneAt).not.toBeNull();
    // A second undo → not_undoable.
    expect(() => store.undo(OPS_ID, d.id, turn.change.id, 3)).toThrow(
      expect.objectContaining({ code: 'not_undoable' }),
    );

    // Older change set, and a change followed by a manual patch → not_undoable.
    const t2 = store.applyTurn(OPS_ID, d.id, 3, 'two', (draft) => void (draft.title = 'Two'));
    const t3 = store.applyTurn(OPS_ID, d.id, 4, 'three', (draft) => void (draft.title = 'Three'));
    expect(() => store.undo(OPS_ID, d.id, t2.change.id, 5)).toThrow(
      expect.objectContaining({ code: 'not_undoable' }),
    );
    const res = await server.api('PATCH', `/api/dashboards/${d.id}`, {
      cookie: ops,
      body: { version: 5, description: 'manual edit' },
      schema: dashboardSchema,
    });
    expect(res.body.version).toBe(6);
    const viaApi = await server.api(
      'POST',
      `/api/dashboards/${d.id}/changes/${t3.change.id}/undo`,
      {
        cookie: ops,
        body: { version: 6 },
      },
    );
    expect(viaApi.status).toBe(409);
    expect(code(viaApi)).toBe('not_undoable');
    const stale = await server.api('POST', `/api/dashboards/${d.id}/changes/${t3.change.id}/undo`, {
      cookie: ops,
      body: { version: 5 },
    });
    expect(code(stale)).toBe('version_conflict');

    // Undo through REST on a fresh turn.
    const t4 = store.applyTurn(OPS_ID, d.id, 6, 'four', (draft) => void draft.widgets.pop());
    const restUndo = await server.api(
      'POST',
      `/api/dashboards/${d.id}/changes/${t4.change.id}/undo`,
      {
        cookie: ops,
        body: { version: 7 },
        schema: dashboardSchema,
      },
    );
    expect(restUndo.body).toMatchObject({ version: 8 });
    expect(restUndo.body.widgets).toHaveLength(1);

    // Pruning: 200 messages kept, oldest dropped, seq keeps increasing.
    for (let n = 0; n < 205; n++)
      store.appendMessage(OPS_ID, d.id, { role: 'user', text: `m${n}` });
    const pruned = await server.api('GET', `/api/dashboards/${d.id}/thread`, {
      cookie: ops,
      schema: dashboardThreadSchema,
    });
    expect(pruned.body.messages).toHaveLength(200);
    expect(pruned.body.messages.at(-1)!.seq).toBe(207);
    expect(pruned.body.messages[0]!.seq).toBe(8);

    // Deleting the dashboard deletes its thread and change sets.
    store.remove(OPS_ID, d.id);
    const db = server.ctx.db;
    for (const t of ['dashboard_messages', 'dashboard_changes'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE dashboard_id = ?`).get(d.id)).toEqual(
        {
          n: 0,
        },
      );
  });
});

describe('F18-T10: persistence across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fms-f18-'));
  const dbPath = join(dir, 'fms.db');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('dashboard, share, thread and version survive close + reopen', async () => {
    let s = await startServer({ dbPath, vehicles: 200 });
    const cookie = await s.login(SEED_USERS.ops);
    const d = (
      await s.api('POST', '/api/dashboards', {
        cookie,
        body: { title: 'Persist me', widgets: [kpi(), note()] },
        schema: dashboardSchema,
      })
    ).body;
    const v2 = (
      await s.api('PATCH', `/api/dashboards/${d.id}`, {
        cookie,
        body: { version: 1, description: 'kept' },
        schema: dashboardSchema,
      })
    ).body;
    await s.api('POST', `/api/dashboards/${d.id}/shares`, {
      cookie,
      body: { userIds: [ADMIN_ID] },
      schema: dashboardShareListSchema,
    });
    s.ctx.dashboards.appendMessage(OPS_ID, d.id, { role: 'user', text: 'remember me' });
    await s.close();

    const started = performance.now();
    s = await startServer({ dbPath, vehicles: 200 });
    (timings['server restart (200 vehicles, file DB)'] ??= []).push(performance.now() - started);
    const cookie2 = await s.login(SEED_USERS.ops);
    const got = await s.api('GET', `/api/dashboards/${d.id}`, {
      cookie: cookie2,
      schema: dashboardSchema,
    });
    expect(got.body).toEqual(v2);
    const shares = await s.api('GET', `/api/dashboards/${d.id}/shares`, {
      cookie: cookie2,
      schema: dashboardShareListSchema,
    });
    expect(shares.body.map((x) => x.userId)).toEqual([ADMIN_ID]);
    const thread = await s.api('GET', `/api/dashboards/${d.id}/thread`, {
      cookie: cookie2,
      schema: dashboardThreadSchema,
    });
    expect(thread.body.messages.map((m) => m.text)).toEqual(['remember me']);
    await s.close();
  });
});
