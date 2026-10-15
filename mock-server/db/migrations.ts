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
];
