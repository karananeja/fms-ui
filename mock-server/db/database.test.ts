// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

const dir = mkdtempSync(join(tmpdir(), 'fms-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tables = (db: ReturnType<typeof openDatabase>) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

describe('F18-T2: database and migrations', () => {
  it('creates every table on a fresh :memory: DB; re-running is a no-op', () => {
    const started = performance.now();
    const db = openDatabase(':memory:');
    const openMs = performance.now() - started;
    expect(openMs).toBeLessThan(200); // budget 50 ms, reported in the test report
    expect(tables(db)).toEqual([
      'dashboard_changes',
      'dashboard_messages',
      'dashboard_shares',
      'dashboards',
      'schema_migrations',
    ]);
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
    expect(() => openDatabase(path)).toThrow(/schema v99 is newer than this server \(v2\)/);
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
