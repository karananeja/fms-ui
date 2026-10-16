import { PERMISSIONS, WS_CLOSE, type Permission } from '@shared/contract/index.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { MockConfig } from '../config.ts';
import type { MockContext } from '../context.ts';
import { FleetTree } from '../generator/fleet-tree.ts';
import {
  DRIVER_ROLE,
  DRIVER_USER_ID,
  hashPassword,
  newSalt,
  SUPER_ADMIN_ROLE,
} from '../store/accounts.ts';
import type { Drivers } from '../store/drivers.ts';
import { atomic } from './database.ts';

/**
 * Bump with any change to the seed generators (fleets, vehicle placement, drivers) or to the
 * seeded accounts: a database seeded by another version is refused at start (F22 §5, D-137).
 */
export const SEED_VERSION = 1;

/** Every F22 table plus the dashboard tables, children first (`schema_migrations` is kept). */
const WIPED_TABLES = [
  // F28–F30 (threads before users).
  'chat_messages',
  'chat_threads',
  'ai_usage',
  'assistant_actions',
  'user_ai_keys',
  'user_ai_prefs',
  'org_settings',
  'audit_log',
  'dashboard_snapshots',
  'dashboard_activity',
  'dashboard_changes',
  'dashboard_messages',
  'dashboard_shares',
  'dashboards',
  'notification_reads',
  'notification_read_all',
  'notifications',
  'share_links',
  'request_events',
  'requests',
  'fleet_settings',
  'assignments',
  'initial_assignment_ends',
  'drivers_created',
  'driver_patches',
  'vehicle_fleet',
  'fleets',
  'sessions',
  'reset_tokens',
  'invites',
  'users',
  'roles',
  'seed_state',
] as const;

const OPERATOR_PERMISSIONS: Permission[] = [
  'live.view',
  'vehicle.details.view',
  'vehicle.parameters.view',
  'table.view',
  'table.export',
  'share.create',
  'share.revoke',
  'requests.manage',
  'analytics.view',
  'chat.use',
  'dashboards.use',
];

interface SeedStateRow {
  seed: number;
  vehicles: number;
  seed_version: number;
}

export function wipeDatabase(db: DatabaseSync): void {
  for (const t of WIPED_TABLES) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'assignments'");
}

/**
 * `'empty'` when the database was never seeded, `'match'` when it was seeded with this config;
 * throws when it was seeded with another seed, vehicle count or `SEED_VERSION`.
 */
export function checkSeedState(
  db: DatabaseSync,
  config: Pick<MockConfig, 'seed' | 'vehicles'>,
): 'empty' | 'match' {
  const row = db
    .prepare('SELECT seed, vehicles, seed_version FROM seed_state WHERE id = 1')
    .get() as SeedStateRow | undefined;
  if (!row) return 'empty';
  if (
    row.seed === config.seed &&
    row.vehicles === config.vehicles &&
    row.seed_version === SEED_VERSION
  )
    return 'match';
  throw new Error(
    `Database was seeded with seed ${row.seed} / ${row.vehicles} vehicles (v${row.seed_version}); ` +
      `this server has seed ${config.seed} / ${config.vehicles} vehicles (v${SEED_VERSION}). ` +
      'Start with MOCK_DB_RESET=1 to wipe and re-seed, or use another MOCK_DB.',
  );
}

/**
 * Writes the deterministic seed (F22 §5): the four roles and seed users (fresh salts), every
 * seeded fleet node, the seed driver link and the `seed_state` marker. Call inside a transaction.
 */
export function seedDatabase(
  db: DatabaseSync,
  { config, drivers, now }: { config: MockConfig; drivers: Drivers; now: number },
): void {
  const tree = new FleetTree();
  const fleetId = (name: string) => [...tree.byId.values()].find((f) => f.name === name)!;

  const role = db.prepare(
    'INSERT INTO roles (id, name, permissions, system, ord) VALUES (?, ?, ?, ?, ?)',
  );
  const roles: [string, string, readonly Permission[], boolean][] = [
    [SUPER_ADMIN_ROLE, 'Super Admin', PERMISSIONS, true],
    ['role-operator', 'Operator', OPERATOR_PERMISSIONS, false],
    ['role-viewer', 'Viewer', ['live.view', 'vehicle.details.view'], false],
    [DRIVER_ROLE, 'Driver', ['driver.self'], true],
  ];
  roles.forEach(([id, name, perms, system], k) =>
    role.run(id, name, JSON.stringify(perms), system ? 1 : 0, k + 1),
  );

  // The driver user takes the name of the first North driver with a vehicle (F11 §6).
  const north = fleetId('North');
  let seedDriver = -1;
  for (let d = 0; d < drivers.gen.assignedCount; d++) {
    if (tree.isDescendant(drivers.gen.fleet[d]!, north.idx)) {
      seedDriver = d;
      break;
    }
  }

  const user = db.prepare(
    `INSERT INTO users (id, email, name, role_id, fleet_ids, status, salt, hash, ord)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  );
  const users: [string, string, string, string, string, string][] = [
    ['u-superadmin', 'superadmin@fms.local', 'Super Admin', 'Admin@123', SUPER_ADMIN_ROLE, tree.rootId],
    ['u-ops', 'ops@fms.local', 'Ops User', 'Ops@1234', 'role-operator', north.id],
    ['u-viewer', 'viewer@fms.local', 'Viewer User', 'View@1234', 'role-viewer', fleetId('Delhi Hub 1').id],
    [
      DRIVER_USER_ID,
      'driver@fms.local',
      seedDriver >= 0 ? drivers.gen.name(seedDriver) : 'Driver User',
      'Drive@1234',
      DRIVER_ROLE,
      north.id,
    ],
  ];
  users.forEach(([id, email, name, password, roleId, fleet], k) => {
    const salt = newSalt();
    user.run(id, email, name, roleId, JSON.stringify([fleet]), salt, hashPassword(password, salt), k + 1);
  });

  const node = db.prepare(
    'INSERT INTO fleets (idx, id, parent_idx, name, depth, city, region) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const n of tree.nodes)
    if (n) node.run(n.idx, n.id, n.parent, n.name, n.depth, n.city, n.region);

  if (seedDriver >= 0)
    db.prepare('INSERT INTO driver_patches (driver_idx, user_id) VALUES (?, ?)').run(
      seedDriver,
      DRIVER_USER_ID,
    );

  db.prepare(
    'INSERT INTO seed_state (id, seed, vehicles, seed_version, seeded_at) VALUES (1, ?, ?, ?, ?)',
  ).run(config.seed, config.vehicles, SEED_VERSION, now);
}

/** Loads every store from the database, in the order generation needs (F22 §4). */
export function hydrateStores(ctx: MockContext, warn: (msg: string) => void = () => {}): void {
  ctx.tree.hydrate(ctx.sim, warn);
  ctx.accounts.hydrate();
  ctx.drivers.hydrate();
  ctx.requests.hydrate();
  ctx.notifications.hydrate();
  ctx.shares.hydrate();
  ctx.aiKeys.hydrate();
  // F29 §5: databases seeded before F29 get `audit.view` on the Super Admin role.
  ctx.actions.hydrate();
}

/**
 * Start-up: wipe when `MOCK_DB_RESET=1`, seed an empty database, refuse a foreign one, then
 * hydrate. Returns whether the database was (re)seeded.
 */
export function prepareStores(ctx: MockContext, warn?: (msg: string) => void): boolean {
  const { db, config, clock, drivers } = ctx;
  // An F18-era database (dashboards only, no marker) is seeded without wiping its dashboards.
  const reset = config.dbReset;
  const seeded = reset || checkSeedState(db, config) === 'empty';
  if (seeded) {
    atomic(db, () => {
      if (reset) wipeDatabase(db);
      seedDatabase(db, { config, drivers, now: clock.now() });
    });
  }
  hydrateStores(ctx, warn);
  return seeded;
}

/** `POST /api/dev/reset` (F22 §7): close sockets, clear dev state, wipe + re-seed, reload. */
export function resetStores(ctx: MockContext): void {
  const { db, config, clock, drivers, hub, accounts, notifications } = ctx;
  hub.closeAll(WS_CLOSE.unauthenticated, 'reset');
  clock.offsetMs = 0;
  accounts.mailbox.length = 0;
  atomic(db, () => {
    wipeDatabase(db);
    seedDatabase(db, { config, drivers, now: clock.now() });
  });
  hydrateStores(ctx);
  hub.clearMoved();
  notifications.tick();
}
