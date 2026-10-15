// @vitest-environment node
import {
  dashboardListSchema,
  dashboardSchema,
  dashboardShareListSchema,
  dashboardSnapshotSchema,
  SNAPSHOT_MAX_BYTES,
} from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../db/migrations.ts';
import { wipeDatabase } from '../db/seed.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

type Server = Awaited<ReturnType<typeof startServer>>;
let server: Server;
let ops: string;
let admin: string;
let viewer: string;
const ADMIN_ID = 'u-superadmin';

/** A tiny RIFF/WEBP header plus filler (the server checks the magic bytes and size only). */
const webp = (size = 64, fill = 7) => {
  const b = new Uint8Array(size).fill(fill);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  return b;
};
const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

const put = (
  cookie: string,
  id: string,
  body: Uint8Array | string,
  type = 'image/webp',
  theme = 'dark',
) =>
  fetch(`${server.base}/api/dashboards/${id}/snapshot?theme=${theme}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': type },
    body,
  });
const get = (cookie: string, id: string, method = 'GET') =>
  fetch(`${server.base}/api/dashboards/${id}/snapshot`, { method, headers: { cookie } });
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

async function newDashboard(cookie = ops) {
  const r = await server.api('POST', '/api/dashboards', {
    cookie,
    body: { title: 'Snap board', widgets: [{ type: 'text', title: 'Note', body: 'Hi' }] },
    schema: dashboardSchema,
  });
  return r.body;
}
const list = async (cookie: string) =>
  (await server.api('GET', '/api/dashboards', { cookie, schema: dashboardListSchema })).body;
const share = (id: string) =>
  server.api('POST', `/api/dashboards/${id}/shares`, {
    cookie: ops,
    body: { userIds: [ADMIN_ID] },
    schema: dashboardShareListSchema,
  });

beforeAll(async () => {
  server = await startServer();
  [ops, admin, viewer] = await Promise.all([
    server.login(SEED_USERS.ops),
    server.login(SEED_USERS.superadmin),
    server.login(SEED_USERS.viewer),
  ]);
});
afterAll(() => server.close());

describe('S-T1: PUT then GET round-trips', () => {
  it('stores bytes, type, theme and capturedAt', async () => {
    const d = await newDashboard();
    expect((await get(ops, d.id)).status).toBe(404);
    const bytes = webp(200);
    const r = await put(ops, d.id, bytes, 'image/webp', 'light');
    expect(r.status).toBe(200);
    const meta = dashboardSnapshotSchema.parse(await r.json());
    expect(meta).toMatchObject({ theme: 'light' });
    expect(meta.url).toBe(`/api/dashboards/${d.id}/snapshot?v=${meta.capturedAt}`);
    const g = await get(ops, d.id);
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('image/webp');
    expect(g.headers.get('x-snapshot-theme')).toBe('light');
    expect(g.headers.get('x-snapshot-captured-at')).toBe(String(meta.capturedAt));
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(bytes);
    const h = await get(ops, d.id, 'HEAD');
    expect(h.status).toBe(200);
    expect(h.headers.get('x-snapshot-theme')).toBe('light');
    // A PNG replaces it.
    expect((await put(ops, d.id, png(), 'image/png')).status).toBe(200);
    expect((await get(ops, d.id)).headers.get('content-type')).toBe('image/png');
  });
});

describe('S-T2: caps and validation', () => {
  it('rejects too large, wrong type, non-images and bad themes', async () => {
    const d = await newDashboard();
    expect((await put(ops, d.id, webp(SNAPSHOT_MAX_BYTES))).status).toBe(200);
    const big = await put(ops, d.id, webp(SNAPSHOT_MAX_BYTES + 1));
    expect(big.status).toBe(413);
    expect(await errCode(big)).toBe('payload_too_large');
    expect((await put(ops, d.id, webp(SNAPSHOT_MAX_BYTES * 3))).status).toBe(413);
    expect((await put(ops, d.id, 'hello', 'text/plain')).status).toBe(415);
    expect((await put(ops, d.id, webp(), 'image/jpeg')).status).toBe(415);
    const fake = await put(ops, d.id, png(), 'image/webp');
    expect(fake.status).toBe(422);
    expect(await errCode(fake)).toBe('validation_failed');
    expect((await put(ops, d.id, webp(), 'image/webp', 'sepia')).status).toBe(422);
  });
});

describe('S-T3/S-T4: access and per-user list items', () => {
  it('viewer keeps their own; strangers get 404; lists show the caller’s only', async () => {
    const d = await newDashboard();
    // Not shared yet: admin is a stranger; the viewer role lacks dashboards.use.
    expect((await put(admin, d.id, webp())).status).toBe(404);
    expect((await get(admin, d.id)).status).toBe(404);
    expect((await put(viewer, d.id, webp())).status).toBe(403);
    await share(d.id);
    expect((await get(admin, d.id)).status).toBe(404);
    expect((await put(admin, d.id, webp(80, 1), 'image/webp', 'dark')).status).toBe(200);
    expect((await get(ops, d.id)).status).toBe(404);
    const adminItem = (await list(admin)).sharedWithMe.find((x) => x.id === d.id)!;
    expect(adminItem.snapshot).toMatchObject({ theme: 'dark' });
    expect((await list(ops)).mine.find((x) => x.id === d.id)!.snapshot).toBeNull();
    expect((await put(ops, d.id, webp(90, 2), 'image/webp', 'light')).status).toBe(200);
    expect((await list(ops)).mine.find((x) => x.id === d.id)!.snapshot).toMatchObject({
      theme: 'light',
    });
    expect(new Uint8Array(await (await get(admin, d.id)).arrayBuffer())).toEqual(webp(80, 1));
  });
});

describe('S-T5: cascade on delete and revoke', () => {
  it('revoking removes the viewer’s snapshot; deleting removes all', async () => {
    const d = await newDashboard();
    await share(d.id);
    await put(ops, d.id, webp());
    await put(admin, d.id, webp());
    const rows = () =>
      (
        server.ctx.db
          .prepare('SELECT COUNT(*) AS n FROM dashboard_snapshots WHERE dashboard_id = ?')
          .get(d.id) as { n: number }
      ).n;
    expect(rows()).toBe(2);
    const rev = await server.api('DELETE', `/api/dashboards/${d.id}/shares/${ADMIN_ID}`, {
      cookie: ops,
    });
    expect(rev.status).toBe(204);
    expect(rows()).toBe(1);
    expect((await get(ops, d.id)).status).toBe(200);
    expect((await server.api('DELETE', `/api/dashboards/${d.id}`, { cookie: ops })).status).toBe(
      204,
    );
    expect(rows()).toBe(0);
  });
});

describe('S-T6: migration and dev reset', () => {
  it('v9 creates the table and wipeDatabase empties it', async () => {
    const v9 = MIGRATIONS.find((m) => m.version === 9);
    expect(v9?.name).toBe('dashboard_snapshots');
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, k) => k + 1));
    const d = await newDashboard();
    await put(ops, d.id, webp());
    const count = () =>
      (server.ctx.db.prepare('SELECT COUNT(*) AS n FROM dashboard_snapshots').get() as { n: number })
        .n;
    expect(count()).toBeGreaterThan(0);
    // Same as POST /api/dev/reset's wipe step, without re-seeding this shared server.
    const db = server.ctx.db;
    db.exec('SAVEPOINT s_t6');
    wipeDatabase(db);
    expect(count()).toBe(0);
    db.exec('ROLLBACK TO s_t6');
    db.exec('RELEASE s_t6');
  });
});
