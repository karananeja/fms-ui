// @vitest-environment node
import {
  chatEventSchema,
  dashboardActivitySchema,
  dashboardListSchema,
  dashboardSchema,
  dashboardShareListSchema,
  dashboardThreadSchema,
  type ChatEvent,
  type Dashboard,
  type ServerMessage,
  type WidgetInput,
} from '@shared/contract/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase } from '../db/database.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { SEED_USERS, startServer, type LiveClient } from '../testing/harness.ts';

process.env.FMS_ASSISTANT_FAKE = '1';

type Server = Awaited<ReturnType<typeof startServer>>;
let server: Server;
let dir: string;
/** owner = Super Admin, editor = Ops, viewer/stranger = extra operators. */
const c = { owner: '', editor: '', viewer: '', stranger: '' };
const OWNER = 'u-superadmin';
const EDITOR = 'u-ops';
let VIEWER = '';

const kpi: WidgetInput = {
  type: 'kpi',
  title: 'Distance',
  source: 'analytics',
  metric: 'distanceKm',
  range: '7d',
};
const note: WidgetInput = { type: 'text', title: 'Note', body: 'hi' };
/** Needs `drivers.manage`, which operators lack. */
const drivers: WidgetInput = { type: 'driver-list', title: 'Drivers', limit: 10 };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'f27-'));
  server = await startServer();
  const { accounts, tree } = server.ctx;
  const v = accounts.addUser('priya@fms.local', 'Priya', 'Priya@1234', 'role-operator', [
    tree.rootId,
  ]);
  VIEWER = v.id;
  accounts.addUser('sam@fms.local', 'Sam', 'Sam@12345', 'role-operator', [tree.rootId]);
  c.owner = await server.login(SEED_USERS.superadmin);
  c.editor = await server.login(SEED_USERS.ops);
  c.viewer = await server.login({ email: 'priya@fms.local', password: 'Priya@1234' });
  c.stranger = await server.login({ email: 'sam@fms.local', password: 'Sam@12345' });
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = (method: string, path: string, cookie: string, body?: unknown) =>
  server.api(method, path, { cookie, body, schema: z.unknown() });

async function shared(title = 'Team board'): Promise<Dashboard> {
  const d = (
    await server.api('POST', '/api/dashboards', {
      cookie: c.owner,
      body: { title, widgets: [kpi, note] },
      schema: dashboardSchema,
    })
  ).body;
  await api('POST', `/api/dashboards/${d.id}/shares`, c.owner, {
    userIds: [EDITOR],
    access: 'edit',
  });
  await api('POST', `/api/dashboards/${d.id}/shares`, c.owner, { userIds: [VIEWER] });
  return d;
}
const get = async (id: string, cookie = c.owner) =>
  (await server.api('GET', `/api/dashboards/${id}`, { cookie, schema: dashboardSchema })).body;

async function sse(path: string, body: unknown, cookie: string, signal?: AbortSignal) {
  const res = await fetch(server.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    signal,
  });
  const events: ChatEvent[] = [];
  if (res.status !== 200) return { status: res.status, events, body: await res.json() };
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, k);
        buf = buf.slice(k + 2);
        if (line.startsWith('data: '))
          events.push(chatEventSchema.parse(JSON.parse(line.slice(6))));
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
  return { status: 200, events, body: null };
}

describe('F27-T1 migration v10', () => {
  it('old shares read view, old threads and change sets belong to the owner', () => {
    const path = join(dir, 'v9.db');
    const v9 = openDatabase(path, MIGRATIONS.slice(0, 9));
    v9.exec(`
      INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at)
        VALUES ('d1', 'u-own', 't', '[]', '{"lg":[],"md":[],"sm":[]}', 0, 0);
      INSERT INTO dashboard_shares (dashboard_id, user_id, shared_by, created_at)
        VALUES ('d1', 'u-other', 'u-own', 1);
      INSERT INTO dashboard_messages (id, dashboard_id, seq, role, text, created_at)
        VALUES ('m1', 'd1', 1, 'user', 'hi', 2);
      INSERT INTO dashboard_changes (id, dashboard_id, summary, before, before_version, after_version, created_at)
        VALUES ('c1', 'd1', 's', '{}', 1, 2, 3);
    `);
    v9.close();
    const db = openDatabase(path, MIGRATIONS);
    const one = (sql: string) => db.prepare(sql).get();
    expect(one('SELECT access FROM dashboard_shares')).toEqual({ access: 'view' });
    expect(one('SELECT user_id FROM dashboard_messages')).toEqual({ user_id: 'u-own' });
    expect(one('SELECT actor_id FROM dashboard_changes')).toEqual({ actor_id: 'u-own' });
    expect(one('SELECT updated_by FROM dashboards')).toEqual({ updated_by: 'u-own' });
    expect(() => db.exec("UPDATE dashboard_shares SET access = 'admin'")).toThrow(/CHECK/);
    db.close();
  });
});

describe('F27-T2 access matrix', () => {
  it('owner / editor / viewer / stranger over every endpoint', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const list = await server.api('GET', '/api/dashboards', {
      cookie: c.editor,
      schema: dashboardListSchema,
    });
    expect(list.body.sharedWithMe.find((s) => s.id === d.id)?.access).toBe('editor');
    expect((await get(d.id, c.editor)).access).toBe('editor');
    expect((await get(d.id, c.viewer)).access).toBe('viewer');

    type Row = [string, string, unknown, number, number, number, number];
    const rows: Row[] = [
      // method, path, body, owner, editor, viewer, stranger
      ['GET', base, undefined, 200, 200, 200, 404],
      ['GET', `${base}/activity`, undefined, 200, 200, 200, 404],
      ['GET', `${base}/thread`, undefined, 200, 200, 403, 404],
      ['GET', `${base}/shares`, undefined, 200, 403, 403, 404],
      ['POST', `${base}/shares`, { userIds: [OWNER] }, 422, 403, 403, 404],
      ['PATCH', `${base}/shares/${VIEWER}`, { access: 'view' }, 200, 403, 403, 404],
      ['POST', `${base}/changes/chg-x/undo`, { version: 1 }, 404, 404, 403, 404],
      ['DELETE', `${base}/shares/u-nobody`, undefined, 204, 403, 403, 404],
    ];
    for (const [method, path, body, ...want] of rows) {
      const got = [];
      for (const who of ['owner', 'editor', 'viewer', 'stranger'] as const)
        got.push((await api(method, path, c[who], body)).status);
      expect([method, path, ...got]).toEqual([method, path, ...want]);
    }
    // PATCH: editor ok, viewer 403, stranger 404 (version from the editor's save).
    const edit = await api('PATCH', base, c.editor, { version: 1, title: 'Edited by Ops' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ access: 'editor', lastEdit: { userId: EDITOR } });
    expect((await api('PATCH', base, c.viewer, { version: 2, title: 'x' })).status).toBe(403);
    expect((await api('PATCH', base, c.stranger, { version: 2, title: 'x' })).status).toBe(404);
    // Chat: viewer 403 (no chat); stranger 404.
    expect((await api('POST', `${base}/chat`, c.viewer, { message: 'hi' })).status).toBe(403);
    expect((await api('POST', `${base}/chat`, c.stranger, { message: 'hi' })).status).toBe(404);
    // Duplicate: anyone with access.
    for (const who of ['editor', 'viewer'] as const) {
      const dup = await api('POST', `${base}/duplicate`, c[who], {});
      expect(dup.status).toBe(201);
      await api('DELETE', `/api/dashboards/${(dup.body as Dashboard).id}`, c[who]);
    }
    // Delete: owner only.
    expect((await api('DELETE', base, c.editor)).status).toBe(403);
    expect((await api('DELETE', base, c.viewer)).status).toBe(403);
    expect((await api('DELETE', base, c.owner)).status).toBe(204);
  });
});

describe('F27-T3/T4 level changes, owner-only sharing, widget_not_permitted', () => {
  it('a level change applies at once; downgrade and revoke delete that thread', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    server.ctx.dashboards.appendMessage(EDITOR, d.id, { role: 'user', text: 'mine' });
    expect((await api('GET', `${base}/thread`, c.editor)).body).toMatchObject({
      messages: [{ text: 'mine' }],
    });
    const down = await server.api('PATCH', `${base}/shares/${EDITOR}`, {
      cookie: c.owner,
      body: { access: 'view' },
      schema: dashboardShareListSchema,
    });
    expect(down.body.find((s) => s.userId === EDITOR)?.access).toBe('view');
    expect((await api('PATCH', base, c.editor, { version: 1, title: 'x' })).status).toBe(403);
    await api('PATCH', `${base}/shares/${EDITOR}`, c.owner, { access: 'edit' });
    expect((await api('GET', `${base}/thread`, c.editor)).body).toEqual({ messages: [] });
    expect((await api('PATCH', base, c.editor, { version: 1, title: 'y' })).status).toBe(200);
    server.ctx.dashboards.appendMessage(EDITOR, d.id, { role: 'user', text: 'again' });
    expect((await api('DELETE', `${base}/shares/${EDITOR}`, c.owner)).status).toBe(204);
    const left = server.ctx.db
      .prepare(
        'SELECT COUNT(*) AS n FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ?',
      )
      .get(d.id, EDITOR);
    expect(left).toEqual({ n: 0 });
    expect((await api('GET', base, c.editor)).status).toBe(404);
    expect(
      (await api('PATCH', `${base}/shares/u-nobody`, c.owner, { access: 'edit' })).status,
    ).toBe(404);
  });

  it('an editor cannot share, change access, revoke or delete; nor add a widget they cannot read', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    expect((await api('POST', `${base}/shares`, c.editor, { userIds: [VIEWER] })).status).toBe(403);
    expect(
      (await api('PATCH', `${base}/shares/${VIEWER}`, c.editor, { access: 'edit' })).status,
    ).toBe(403);
    expect((await api('DELETE', `${base}/shares/${VIEWER}`, c.editor)).status).toBe(403);
    expect((await api('DELETE', base, c.editor)).status).toBe(403);
    const cur = await get(d.id);
    const denied = await api('PATCH', base, c.editor, {
      version: cur.version,
      widgets: [...cur.widgets, drivers],
    });
    expect(denied.status).toBe(422);
    expect(denied.body).toMatchObject({ error: { code: 'widget_not_permitted' } });
    // The owner (Super Admin) can add it; the editor can still move/rename around it.
    const ok = await api('PATCH', base, c.owner, {
      version: cur.version,
      widgets: [...cur.widgets, drivers],
    });
    expect(ok.status).toBe(200);
    const after = ok.body as Dashboard;
    expect(
      (await api('PATCH', base, c.editor, { version: after.version, title: 'Still editable' }))
        .status,
    ).toBe(200);
  });
});

describe('F27-T5 concurrent saves and activity', () => {
  it('two editors save the same version: one 409, nothing lost; activity says who', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const [a, b] = await Promise.all([
      api('PATCH', base, c.owner, { version: 1, title: 'Owner title' }),
      api('PATCH', base, c.editor, { version: 1, description: 'Editor desc' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ error: { code: 'version_conflict' } });
    const now = await get(d.id);
    expect(now.version).toBe(2);
    // The loser re-reads and saves again: both edits are kept.
    const retry =
      a.status === 409
        ? await api('PATCH', base, c.owner, { version: 2, title: 'Owner title' })
        : await api('PATCH', base, c.editor, { version: 2, description: 'Editor desc' });
    expect(retry.status).toBe(200);
    const final = await get(d.id, c.viewer);
    expect(final).toMatchObject({ title: 'Owner title', description: 'Editor desc', version: 3 });
    expect(final.lastEdit?.userId).toBe(a.status === 409 ? OWNER : EDITOR);
    const act = await server.api('GET', `${base}/activity`, {
      cookie: c.viewer,
      schema: dashboardActivitySchema,
    });
    expect(act.body.items.map((i) => i.name).sort()).toEqual(['Ops User', 'Super Admin'].sort());
    expect(act.body.items.map((i) => i.summary)).toContain('Edited the description');
    expect(JSON.stringify(act.body)).not.toContain('"text"');
  });
});

describe('F27-T6 private threads, own undo, chat_busy holder', () => {
  it('editor and owner threads are separate; undo only by the actor', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const turn = await sse(`${base}/chat`, { message: 'hello' }, c.editor);
    expect(turn.status).toBe(200);
    expect(turn.events.at(-1)!.type).toBe('done');
    const mine = await server.api('GET', `${base}/thread`, {
      cookie: c.editor,
      schema: dashboardThreadSchema,
    });
    expect(mine.body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const owners = await server.api('GET', `${base}/thread`, {
      cookie: c.owner,
      schema: dashboardThreadSchema,
    });
    expect(owners.body.messages).toEqual([]);

    // A change set by the owner (store, as an AI tool call would) is undoable only by the owner.
    const cur = await get(d.id);
    const res = server.ctx.dashboards.applyTurn(OWNER, d.id, cur.version, 'Renamed', (dr) => {
      dr.title = 'AI title';
    });
    expect(res.change.undoable).toBe(true);
    const byEditor = await api('POST', `${base}/changes/${res.change.id}/undo`, c.editor, {
      version: res.dashboard.version,
    });
    expect(byEditor.status).toBe(409);
    expect(byEditor.body).toMatchObject({ error: { code: 'not_undoable' } });
    const byOwner = await api('POST', `${base}/changes/${res.change.id}/undo`, c.owner, {
      version: res.dashboard.version,
    });
    expect(byOwner.status).toBe(200);
    expect((byOwner.body as Dashboard).title).toBe('Team board');
    // The editor's own AI change records them as the actor.
    const now = await get(d.id);
    const ed = server.ctx.dashboards.applyTurn(EDITOR, d.id, now.version, 'Note', (dr) => {
      dr.widgets.push(note);
    });
    expect((await get(d.id, c.viewer)).lastEdit).toMatchObject({
      userId: EDITOR,
      name: 'Ops User',
    });
    expect(
      (
        await api('POST', `${base}/changes/${ed.change.id}/undo`, c.editor, {
          version: ed.dashboard.version,
        })
      ).status,
    ).toBe(200);
  });

  it("an editor's AI turn edits the shared dashboard as the editor (tools, actor, undo)", async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const turn = await sse(`${base}/chat`, { message: 'build it' }, c.editor);
    const changes = turn.events.filter(
      (e): e is Extract<ChatEvent, { type: 'dashboard_changed' }> => e.type === 'dashboard_changed',
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1)!.dashboard.access).toBe('editor');
    expect((await get(d.id)).lastEdit).toMatchObject({ userId: EDITOR });
    const t = await server.api('GET', `${base}/thread`, {
      cookie: c.editor,
      schema: dashboardThreadSchema,
    });
    const change = t.body.messages.find((m) => m.change)!.change!;
    expect(change.undoable).toBe(true);
    // The owner sees no Undo for it (not theirs) and has no thread of their own here.
    expect((await api('GET', `${base}/thread`, c.owner)).body).toEqual({ messages: [] });
    const undo = await api('POST', `${base}/changes/${change.id}/undo`, c.editor, {
      version: change.afterVersion,
    });
    expect(undo.status).toBe(200);
  });

  it('a second turn by someone else gets chat_busy naming the holder', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const controller = new AbortController();
    const slow = sse(`${base}/chat`, { message: '[fake:slow]' }, c.owner, controller.signal);
    for (let k = 0; k < 100; k++) {
      const s = (await (await fetch(`${server.base}/api/dev/assistant/stats`)).json()) as {
        activeRuns: number;
      };
      if (s.activeRuns > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = await api('POST', `${base}/chat`, c.editor, { message: 'hi' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: {
        code: 'chat_busy',
        message: 'Super Admin is asking the assistant…',
        details: { by: { userId: OWNER, name: 'Super Admin' } },
      },
    });
    controller.abort();
    await slow;
  });
});

describe('F27-T7 WebSocket topic dashboard', () => {
  const sub = (ws: LiveClient, dashboardId: string, id = 'd1') =>
    ws.send({
      type: 'subscribe',
      id,
      topic: 'dashboard',
      scope: { kind: 'dashboard', dashboardId },
    });
  const dashMsgs = (ws: LiveClient) =>
    ws.messages.filter(
      (m): m is Extract<ServerMessage, { type: 'dashboard' }> => m.type === 'dashboard',
    );

  it('subscribe rules; changed, access and deleted events', async () => {
    const d = await shared();
    const base = `/api/dashboards/${d.id}`;
    const [own, ed, view, str] = await Promise.all([
      server.ws({ cookie: c.owner }),
      server.ws({ cookie: c.editor }),
      server.ws({ cookie: c.viewer }),
      server.ws({ cookie: c.stranger }),
    ]);
    for (const ws of [own, ed, view, str]) sub(ws, d.id);
    await Promise.all([own, ed, view].map((ws) => ws.waitFor('subscribed', (m) => m.id === 'd1')));
    const err = await str.waitFor('error', (m) => m.id === 'd1');
    expect(err.code).toBe('not_found');
    own.send({ type: 'subscribe', id: 'bad2', topic: 'dashboard', scope: { kind: 'self' } });
    expect((await own.waitFor('error', (m) => m.id === 'bad2')).code).toBe('validation_failed');

    await api('PATCH', base, c.editor, { version: 1, title: 'Live' });
    for (const ws of [own, view]) {
      const m = await ws.waitFor('dashboard', (x) => x.event.kind === 'changed');
      expect(m.event).toMatchObject({ kind: 'changed', version: 2, by: { name: 'Ops User' } });
    }
    // Downgrade: only the editor gets `access: viewer`.
    await api('PATCH', `${base}/shares/${EDITOR}`, c.owner, { access: 'view' });
    const acc = await ed.waitFor('dashboard', (x) => x.event.kind === 'access');
    expect(acc.event).toMatchObject({ access: 'viewer' });
    // Revoke the viewer: `access: null`, then no more events for them.
    await api('DELETE', `${base}/shares/${VIEWER}`, c.owner);
    const gone = await view.waitFor('dashboard', (x) => x.event.kind === 'access');
    expect(gone.event).toMatchObject({ access: null });
    const before = dashMsgs(view).length;
    await api('PATCH', base, c.owner, { version: 2, title: 'After revoke' });
    await ed.waitFor('dashboard', (x) => x.event.kind === 'changed' && x.event.version === 3);
    expect(dashMsgs(view).length).toBe(before);
    expect(dashMsgs(own).some((m) => m.event.kind === 'access')).toBe(false);
    // Delete: everyone still subscribed hears it.
    await api('DELETE', base, c.owner);
    await ed.waitFor('dashboard', (x) => x.event.kind === 'deleted');
    for (const ws of [own, ed, view, str]) {
      expect(ws.invalid).toEqual([]);
      ws.close();
    }
  });

  it('assistant running / idle, and a late subscriber sees who is asking', async () => {
    const d = await shared();
    const own = await server.ws({ cookie: c.owner });
    sub(own, d.id);
    await own.waitFor('subscribed');
    const controller = new AbortController();
    const slow = sse(
      `/api/dashboards/${d.id}/chat`,
      { message: '[fake:slow]' },
      c.editor,
      controller.signal,
    );
    const run = await own.waitFor('dashboard', (x) => x.event.kind === 'assistant');
    expect(run.event).toMatchObject({ running: true, by: { userId: EDITOR, name: 'Ops User' } });
    const late = await server.ws({ cookie: c.viewer });
    sub(late, d.id);
    const seen = await late.waitFor('dashboard', (x) => x.event.kind === 'assistant');
    expect(seen.event).toMatchObject({ running: true, by: { name: 'Ops User' } });
    controller.abort();
    await slow;
    const idle = await own.waitFor(
      'dashboard',
      (x) => x.event.kind === 'assistant' && !x.event.running,
      5000,
    );
    expect(idle.event).toMatchObject({ by: null });
    own.close();
    late.close();
  });
});
