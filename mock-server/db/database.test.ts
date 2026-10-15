// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { atomic, migrate, openDatabase, transaction } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

const dir = mkdtempSync(join(tmpdir(), 'fms-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tables = (db: ReturnType<typeof openDatabase>) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

const ALL_TABLES = [
  'assignments',
  'dashboard_changes',
  'dashboard_messages',
  'dashboard_shares',
  'dashboards',
  'driver_patches',
  'drivers_created',
  'fleet_settings',
  'fleets',
  'initial_assignment_ends',
  'invites',
  'notification_read_all',
  'notification_reads',
  'notifications',
  'request_events',
  'requests',
  'reset_tokens',
  'roles',
  'schema_migrations',
  'seed_state',
  'sessions',
  'share_links',
  'sqlite_sequence',
  'users',
  'vehicle_fleet',
];

describe('F18-T2: database and migrations', () => {
  it('creates every table on a fresh :memory: DB; re-running is a no-op', () => {
    const started = performance.now();
    const db = openDatabase(':memory:');
    const openMs = performance.now() - started;
    expect(openMs).toBeLessThan(200); // budget 50 ms, reported in the test report
    expect(tables(db)).toEqual(ALL_TABLES);
    const before = db.prepare('SELECT * FROM schema_migrations').all();
    migrate(db, MIGRATIONS, () => 1);
    migrate(db, MIGRATIONS, () => 2);
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(before);
    expect(before).toHaveLength(MIGRATIONS.length);
    db.close();
  });

  it('refuses to open a DB stamped with a newer schema version', () => {
    const path = join(dir, 'future.db');
    const db = openDatabase(path);
    db.prepare('INSERT INTO schema_migrations VALUES (99, ?, 0)').run('future');
    db.close();
    expect(() => openDatabase(path)).toThrow(/schema v99 is newer than this server \(v7\)/);
  });

  it('foreign-key cascade removes shares, messages and change sets', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at)
        VALUES ('d1', 'u', 't', '[]', '{}', 0, 0);
      INSERT INTO dashboard_shares VALUES ('d1', 'u2', 'u', 0);
      INSERT INTO dashboard_messages (id, dashboard_id, seq, role, text, created_at)
        VALUES ('m1', 'd1', 1, 'user', 'hi', 0);
      INSERT INTO dashboard_changes (id, dashboard_id, summary, before, before_version, after_version, created_at)
        VALUES ('c1', 'd1', 's', '{}', 1, 2, 0);
    `);
    expect(() => db.exec("INSERT INTO dashboard_shares VALUES ('nope', 'u2', 'u', 0)")).toThrow(
      /FOREIGN KEY/,
    );
    db.exec("DELETE FROM dashboards WHERE id = 'd1'");
    for (const t of ['dashboard_shares', 'dashboard_messages', 'dashboard_changes'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    expect(() =>
      db.exec(
        "INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at) VALUES ('d2', 'u', 't', 'not json', '{}', 0, 0)",
      ),
    ).toThrow(/CHECK/);
    db.close();
  });
});

describe('F22-T1: migrations v3–v7 and atomic()', () => {
  it('upgrades an F18-era (v2) file: v3–v7 apply, dashboards kept; re-open is a no-op', () => {
    const path = join(dir, 'f18-v2.db');
    const v2 = openDatabase(path, MIGRATIONS.slice(0, 2));
    v2.exec(`INSERT INTO dashboards (id, owner_id, title, widgets, layout, created_at, updated_at)
      VALUES ('d1', 'u-superadmin', 'Mine', '[]', '{}', 1, 1)`);
    v2.close();
    const db = openDatabase(path);
    expect(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual(
      MIGRATIONS.map((m) => ({ version: m.version, name: m.name })),
    );
    expect(tables(db)).toEqual(ALL_TABLES);
    expect(db.prepare('SELECT id, owner_id FROM dashboards').all()).toEqual([
      { id: 'd1', owner_id: 'u-superadmin' },
    ]);
    const before = db.prepare('SELECT * FROM schema_migrations').all();
    db.close();
    const again = openDatabase(path);
    expect(again.prepare('SELECT * FROM schema_migrations').all()).toEqual(before);
    expect(() =>
      again.exec(
        "INSERT INTO users (id, email, name, role_id, fleet_ids, status, salt, hash, ord) VALUES ('u', 'e', 'n', 'r', 'nope', 'active', 's', 'h', 1)",
      ),
    ).toThrow(/CHECK/);
    again.close();
  });

  it('atomic is re-entrant and rolls back the outermost transaction on throw', () => {
    const db = openDatabase(':memory:');
    const put = db.prepare('INSERT INTO fleet_settings (fleet_idx, auto_assign) VALUES (?, 1)');
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM fleet_settings').get() as { n: number }).n;
    atomic(db, () => {
      put.run(1);
      atomic(db, () => put.run(2));
      expect(db.isTransaction).toBe(true);
    });
    expect(db.isTransaction).toBe(false);
    expect(count()).toBe(2);
    expect(() =>
      atomic(db, () => {
        put.run(3);
        atomic(db, () => {
          put.run(4);
          throw new Error('boom');
        });
      }),
    ).toThrow('boom');
    expect(db.isTransaction).toBe(false);
    expect(count()).toBe(2);
    // Nests inside the F18 transaction() too.
    transaction(db, () => atomic(db, () => put.run(5)));
    expect(count()).toBe(3);
    db.close();
  });
});
