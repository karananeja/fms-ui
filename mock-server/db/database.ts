import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.ts';

export const MEMORY_DB = ':memory:';

/**
 * Opens the mock-server database (D-112, D-119): pragmas, then every pending migration in
 * its own transaction. Throws (and closes) when the file has a schema newer than this code.
 */
export function openDatabase(
  path: string,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => number = Date.now,
): DatabaseSync {
  const file = path !== MEMORY_DB && path !== '';
  if (file) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 2000');
    db.exec('PRAGMA synchronous = NORMAL');
    if (file) db.exec('PRAGMA journal_mode = WAL');
    migrate(db, migrations, now);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function migrate(db: DatabaseSync, migrations: readonly Migration[], now: () => number) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  const applied = row.v ?? 0;
  const latest = migrations.reduce((m, x) => Math.max(m, x.version), 0);
  if (applied > latest) {
    throw new Error(`Database schema v${applied} is newer than this server (v${latest})`);
  }
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= applied) continue;
    transaction(db, () => {
      db.exec(m.sql);
      record.run(m.version, m.name, now());
    });
  }
}

/** Runs `fn` in `BEGIN IMMEDIATE … COMMIT`, rolling back if it throws. Not re-entrant. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const depth = new WeakMap<DatabaseSync, number>();

/**
 * Re-entrant transaction (F22, D-140): the outermost call runs `BEGIN IMMEDIATE … COMMIT` and
 * rolls back if anything inside throws; nested calls (one mutation crossing stores) just run.
 * Also nests inside a `transaction()` that is already open on this connection.
 */
export function atomic<T>(db: DatabaseSync, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0 || db.isTransaction) {
    depth.set(db, d + 1);
    try {
      return fn();
    } finally {
      depth.set(db, d);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  } finally {
    depth.set(db, 0);
  }
}
