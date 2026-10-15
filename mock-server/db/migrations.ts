/**
 * Ordered, append-only schema migrations (D-119). Never edit a shipped entry; add a new
 * version instead. `schema_migrations` itself is created by `openDatabase`.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'dashboards',
    sql: `
CREATE TABLE dashboards (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  widgets     TEXT NOT NULL CHECK (json_valid(widgets)),
  layout      TEXT NOT NULL CHECK (json_valid(layout)),
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX dashboards_owner ON dashboards (owner_id, updated_at DESC);

CREATE TABLE dashboard_shares (
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  shared_by    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (dashboard_id, user_id)
);
CREATE INDEX dashboard_shares_user ON dashboard_shares (user_id);

CREATE TABLE dashboard_messages (
  id           TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text         TEXT NOT NULL,
  chips        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(chips)),
  change_id    TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (dashboard_id, seq)
);

CREATE TABLE dashboard_changes (
  id             TEXT PRIMARY KEY,
  dashboard_id   TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  summary        TEXT NOT NULL,
  before         TEXT NOT NULL CHECK (json_valid(before)),
  before_version INTEGER NOT NULL,
  after_version  INTEGER NOT NULL,
  undone_at      INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX dashboard_changes_dash ON dashboard_changes (dashboard_id, created_at DESC);
`,
  },
  {
    version: 2,
    name: 'dashboard_message_previews',
    // D-135: widget previews per assistant message; existing rows read as [].
    sql: `
ALTER TABLE dashboard_messages
  ADD COLUMN previews_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(previews_json));
`,
  },
  {
    version: 3,
    name: 'accounts',
    // F22 (D-136…D-138): seed marker, roles, users (scrypt), invites, sessions, reset tokens.
    // Session, invite and reset tokens are stored as SHA-256 hashes only.
    sql: `
CREATE TABLE seed_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  seed         INTEGER NOT NULL,
  vehicles     INTEGER NOT NULL,
  seed_version INTEGER NOT NULL,
  seeded_at    INTEGER NOT NULL
);
CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  permissions TEXT NOT NULL CHECK (json_valid(permissions)),
  system      INTEGER NOT NULL,
  ord         INTEGER NOT NULL
);
CREATE TABLE users (
  id        TEXT PRIMARY KEY,
  email     TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  role_id   TEXT NOT NULL,
  fleet_ids TEXT NOT NULL CHECK (json_valid(fleet_ids)),
  status    TEXT NOT NULL CHECK (status IN ('active','disabled')),
  salt      TEXT NOT NULL,
  hash      TEXT NOT NULL,
  ord       INTEGER NOT NULL
);
CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  fleet_ids  TEXT NOT NULL CHECK (json_valid(fleet_ids)),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status     TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  driver_idx INTEGER,
  ord        INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
`,
  },
  {
    version: 4,
    name: 'fleets',
    // F22 (D-139): every fleet node; vehicle placements only when moved.
    sql: `
CREATE TABLE fleets (
  idx        INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  parent_idx INTEGER NOT NULL,
  name       TEXT NOT NULL,
  depth      INTEGER NOT NULL,
  city       INTEGER NOT NULL,
  region     INTEGER NOT NULL
);
CREATE TABLE vehicle_fleet (
  vehicle_id TEXT PRIMARY KEY,
  fleet_idx  INTEGER NOT NULL
);
`,
  },
  {
    version: 5,
    name: 'drivers',
    // F22: overlay on the generated drivers (D-092); NULL patch columns mean "unchanged".
    sql: `
CREATE TABLE driver_patches (
  driver_idx INTEGER PRIMARY KEY,
  name       TEXT,
  phone      TEXT,
  fleet_idx  INTEGER,
  status     TEXT,
  user_id    TEXT
);
CREATE TABLE drivers_created (
  driver_idx INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  fleet_idx  INTEGER NOT NULL,
  status     TEXT NOT NULL,
  user_id    TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE initial_assignment_ends (
  driver_idx INTEGER PRIMARY KEY,
  ended_at   INTEGER NOT NULL
);
CREATE TABLE assignments (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  driver_idx INTEGER NOT NULL,
  vehicle_id TEXT NOT NULL,
  from_at    INTEGER NOT NULL,
  to_at      INTEGER,
  by         TEXT NOT NULL
);
CREATE INDEX assignments_open ON assignments (driver_idx) WHERE to_at IS NULL;
`,
  },
  {
    version: 6,
    name: 'requests',
    sql: `
CREATE TABLE requests (
  seq         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL,
  vehicle_id  TEXT NOT NULL,
  driver_id   TEXT NOT NULL,
  fleet_id    TEXT NOT NULL,
  status      TEXT NOT NULL,
  reason      TEXT,
  note        TEXT NOT NULL,
  location    TEXT CHECK (location IS NULL OR json_valid(location)),
  rsa         TEXT CHECK (rsa IS NULL OR json_valid(rsa)),
  replacement TEXT CHECK (replacement IS NULL OR json_valid(replacement)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE request_events (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  status     TEXT NOT NULL,
  by         TEXT NOT NULL,
  note       TEXT,
  PRIMARY KEY (request_id, n)
);
CREATE TABLE fleet_settings (
  fleet_idx   INTEGER PRIMARY KEY,
  auto_assign INTEGER NOT NULL
);
`,
  },
  {
    version: 7,
    name: 'notifications_and_shares',
    sql: `
CREATE TABLE notifications (
  seq        INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  severity   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  fleet_id   TEXT NOT NULL,
  vehicle_id TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  audience   TEXT NOT NULL CHECK (json_valid(audience))
);
CREATE TABLE notification_reads (
  user_id          TEXT NOT NULL,
  notification_seq INTEGER NOT NULL REFERENCES notifications(seq) ON DELETE CASCADE,
  read_at          INTEGER NOT NULL,
  PRIMARY KEY (user_id, notification_seq)
);
CREATE TABLE notification_read_all (
  user_id TEXT PRIMARY KEY,
  all_seq INTEGER NOT NULL,
  all_at  INTEGER NOT NULL
);
CREATE TABLE share_links (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  vehicle_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  show       TEXT NOT NULL CHECK (json_valid(show)),
  trail      TEXT NOT NULL CHECK (json_valid(trail)),
  revoked_at INTEGER
);
`,
  },
  {
    version: 8,
    name: 'ai_keys',
    // F25 (D-143): per-user AI keys (AES-256-GCM `secret`, masked copy for display), org
    // settings (server-key fallback) and an audit log without key material.
    sql: `
CREATE TABLE user_ai_keys (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL CHECK (provider IN ('xai','openai','anthropic')),
  model      TEXT NOT NULL,
  secret     TEXT NOT NULL,
  masked     TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE org_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE audit_log (
  seq      INTEGER PRIMARY KEY,
  at       INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL,
  details  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details))
);
`,
  },
  {
    version: 9,
    name: 'dashboard_snapshots',
    // F20 addendum (D-142): one list-card snapshot per (dashboard, viewer), WebP/PNG ≤ 120 KB.
    sql: `
CREATE TABLE dashboard_snapshots (
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  theme        TEXT NOT NULL CHECK (theme IN ('light','dark')),
  mime         TEXT NOT NULL,
  image        BLOB NOT NULL,
  captured_at  INTEGER NOT NULL,
  PRIMARY KEY (dashboard_id, user_id)
);
`,
  },
  {
    version: 10,
    name: 'dashboard_edit_sharing',
    // F27 (D-150…D-152): per-share view/edit, threads per (dashboard, user) (existing rows are
    // the owner's), change-set actor, last editor and a small activity list.
    sql: `
ALTER TABLE dashboard_shares
  ADD COLUMN access TEXT NOT NULL DEFAULT 'view' CHECK (access IN ('view','edit'));
ALTER TABLE dashboard_messages ADD COLUMN user_id TEXT;
UPDATE dashboard_messages
  SET user_id = (SELECT d.owner_id FROM dashboards d WHERE d.id = dashboard_messages.dashboard_id);
CREATE INDEX dashboard_messages_user ON dashboard_messages (dashboard_id, user_id, seq);
ALTER TABLE dashboard_changes ADD COLUMN actor_id TEXT;
UPDATE dashboard_changes
  SET actor_id = (SELECT d.owner_id FROM dashboards d WHERE d.id = dashboard_changes.dashboard_id);
ALTER TABLE dashboards ADD COLUMN updated_by TEXT;
UPDATE dashboards SET updated_by = owner_id;
CREATE TABLE dashboard_activity (
  id           TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  summary      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  change_id    TEXT,
  manual       INTEGER NOT NULL DEFAULT 0,
  at           INTEGER NOT NULL
);
CREATE INDEX dashboard_activity_dash ON dashboard_activity (dashboard_id, at DESC);
`,
  },
];
