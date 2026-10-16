// @vitest-environment node
import {
  dashboardActivitySchema,
  dashboardSchema,
  type Dashboard,
  type WidgetInput,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/**
 * D-161: a dashboard's Activity entries are actionable: Undo just that entry (refused once a
 * later change touched the same widgets), Restore to before it (reverts later changes too).
 * Owners and editors only; each action is recorded as its own entry.
 */

process.env.FMS_ASSISTANT_FAKE = '1';

type Server = Awaited<ReturnType<typeof startServer>>;
let server: Server;
const c = { owner: '', editor: '', viewer: '' };
const EDITOR = 'u-ops';
let VIEWER = '';

const note = (title: string): WidgetInput => ({ type: 'text', title, body: title });

beforeAll(async () => {
  server = await startServer();
  const v = server.ctx.accounts.addUser('vee@fms.local', 'Vee', 'Vee@12345', 'role-operator', [
    server.ctx.tree.rootId,
  ]);
  VIEWER = v.id;
  c.owner = await server.login(SEED_USERS.superadmin);
  c.editor = await server.login(SEED_USERS.ops);
  c.viewer = await server.login({ email: 'vee@fms.local', password: 'Vee@12345' });
});
afterAll(() => server.close());

const api = (method: string, path: string, cookie: string, body?: unknown) =>
  server.api(method, path, { cookie, body, schema: z.unknown() });
const get = async (id: string) =>
  (await server.api('GET', `/api/dashboards/${id}`, { cookie: c.owner, schema: dashboardSchema }))
    .body;
const activity = async (id: string, cookie = c.owner) =>
  (
    await server.api('GET', `/api/dashboards/${id}/activity`, {
      cookie,
      schema: dashboardActivitySchema,
    })
  ).body.items;
/** A manual save by `cookie` (owner and editor alternate, so entries are not merged). */
async function patch(d: Dashboard, cookie: string, body: object): Promise<Dashboard> {
  const cur = await get(d.id);
  const res = await server.api('PATCH', `/api/dashboards/${d.id}`, {
    cookie,
    body: { version: cur.version, ...body },
    schema: dashboardSchema,
  });
  expect(res.status).toBe(200);
  return res.body;
}

async function board(): Promise<Dashboard> {
  const d = (
    await server.api('POST', '/api/dashboards', {
      cookie: c.owner,
      body: { title: 'Board', widgets: [note('A'), note('B')] },
      schema: dashboardSchema,
    })
  ).body;
  await api('POST', `/api/dashboards/${d.id}/shares`, c.owner, { userIds: [EDITOR], access: 'edit' });
  await api('POST', `/api/dashboards/${d.id}/shares`, c.owner, { userIds: [VIEWER] });
  return d;
}

describe('D-161 dashboard Activity actions', () => {
  it('Undo reverses only that entry; refused once a later change touched the same widget', async () => {
    const d = await board();
    const [a, b] = d.widgets;
    // 1) Editor removes A. 2) Owner renames the dashboard.
    await patch(d, c.editor, { widgets: [b] });
    await patch(d, c.owner, { title: 'Renamed' });
    let items = await activity(d.id);
    expect(items.map((i) => i.summary)).toEqual(['Renamed to “Renamed”', 'Removed 1 widget']);
    const removal = items[1]!;
    // A is gone, so there is nothing to Show.
    expect(removal).toMatchObject({ undoable: true, restorable: true, widgetIds: [] });

    // Undo the removal only: A is back, the later rename stays.
    const undone = await server.api('POST', `/api/dashboards/${d.id}/activity/${removal.id}/undo`, {
      cookie: c.owner,
      body: { version: (await get(d.id)).version },
      schema: dashboardSchema,
    });
    expect(undone.status).toBe(200);
    expect(undone.body.title).toBe('Renamed');
    expect(undone.body.widgets.map((w) => w.title).sort()).toEqual(['A', 'B']);
    expect(undone.body.layout.lg.some((l) => l.i === a!.id)).toBe(true);
    items = await activity(d.id);
    expect(items[0]!.summary).toBe('Undid: Removed 1 widget');
    expect(items.find((i) => i.id === removal.id)).toMatchObject({ undone: true, undoable: false });

    // A later edit of B blocks undoing an earlier edit of B.
    await patch(d, c.editor, { widgets: [a!, { ...b!, title: 'B2' }] });
    await patch(d, c.owner, { widgets: [a!, { ...b!, title: 'B3' }] });
    items = await activity(d.id);
    const earlier = items[1]!;
    expect(earlier.undoable).toBe(false);
    const refused = await api('POST', `/api/dashboards/${d.id}/activity/${earlier.id}/undo`, c.owner, {
      version: (await get(d.id)).version,
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { code: 'not_undoable' } });
  });

  it('Restore puts the whole dashboard back to before the entry; viewers cannot act', async () => {
    const d = await board();
    await patch(d, c.editor, { title: 'One' });
    await patch(d, c.owner, { widgets: [d.widgets[0]!] });
    const items = await activity(d.id);
    const first = items.find((i) => i.summary === 'Renamed to “One”')!;
    const restored = await server.api('POST', `/api/dashboards/${d.id}/activity/${first.id}/restore`, {
      cookie: c.editor,
      body: { version: (await get(d.id)).version },
      schema: dashboardSchema,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.title).toBe('Board');
    expect(restored.body.widgets).toHaveLength(2);
    expect((await activity(d.id))[0]!.summary).toBe('Restored to before: Renamed to “One”');

    // The viewer sees the list but no actions, and the API refuses them.
    const seen = await activity(d.id, c.viewer);
    expect(seen.every((i) => !i.undoable && !i.restorable)).toBe(true);
    const no = await api('POST', `/api/dashboards/${d.id}/activity/${first.id}/restore`, c.viewer, {
      version: (await get(d.id)).version,
    });
    expect(no.status).toBe(403);
    // A stale version is refused like any other write.
    const stale = await api('POST', `/api/dashboards/${d.id}/activity/${first.id}/undo`, c.owner, {
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'version_conflict' } });
  });
});
