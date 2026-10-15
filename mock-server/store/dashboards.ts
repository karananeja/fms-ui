import {
  BREAKPOINT_IDS,
  DASHBOARD_BREAKPOINTS,
  DASHBOARDS_PER_USER,
  DEFAULT_DASHBOARD_TITLE,
  DASHBOARD_DESCRIPTION_MAX,
  DASHBOARD_TITLE_MAX,
  SHARES_PER_DASHBOARD,
  THREAD_MESSAGES_MAX,
  WIDGET_SIZES,
  WIDGETS_PER_DASHBOARD,
  appendMessageSchema,
  createDashboardBodySchema,
  dashboardContentSchema,
  dashboardLayoutSchema,
  layoutIssues,
  updateDashboardBodySchema,
  widgetInputSchema,
  widgetPermission,
  type AppendMessage,
  type ChangeSet,
  type CreateDashboardBody,
  type Dashboard,
  type DashboardContent,
  type DashboardLayout,
  type DashboardList,
  type DashboardShare,
  type DashboardSummary,
  type DashboardThread,
  type LayoutItem,
  type Permission,
  type ShareCandidate,
  type ThreadMessage,
  type ToolChip,
  type UpdateDashboardBody,
  type User,
  type Widget,
  type WidgetInput,
} from '@shared/contract/index.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Clock } from '../clock.ts';
import { parse } from '../context.ts';
import { transaction } from '../db/database.ts';
import type { FleetTree } from '../generator/fleet-tree.ts';
import { HttpError } from '../http-error.ts';
import type { Accounts } from './accounts.ts';

export const CHANGE_SETS_KEPT = 20;
export const FORMER_USER = 'Former user';

/** What an F19 turn mutates; `widgets` may lack ids (assigned on commit), `layout` is normalised. */
export interface DashboardDraft {
  title: string;
  description: string;
  widgets: WidgetInput[];
  layout: DashboardLayout;
}

interface DashRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  widgets: string;
  layout: string;
  version: number;
  created_at: number;
  updated_at: number;
}
interface ChangeRow {
  id: string;
  dashboard_id: string;
  summary: string;
  before: string;
  before_version: number;
  after_version: number;
  undone_at: number | null;
  created_at: number;
}
interface MessageRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  chips: string;
  change_id: string | null;
  created_at: number;
}

const draftSchema = z.strictObject({
  title: z.string(),
  description: z.string(),
  widgets: z.array(widgetInputSchema).max(WIDGETS_PER_DASHBOARD),
  layout: dashboardLayoutSchema,
});

const notFound = () => new HttpError(404, 'not_found', 'Dashboard not found');

export const newWidgetId = () => `w-${randomBytes(4).toString('hex')}`;

/**
 * §3.4: drops items for widgets that no longer exist and appends a default-sized item (packed
 * in rows at the bottom) for every widget without one, at every breakpoint.
 */
export function normaliseLayout(
  widgets: readonly Pick<Widget, 'id' | 'type'>[],
  layout?: Partial<DashboardLayout>,
): DashboardLayout {
  const ids = new Set(widgets.map((w) => w.id));
  const out = { lg: [], md: [], sm: [] } as DashboardLayout;
  for (const bp of BREAKPOINT_IDS) {
    const { cols } = DASHBOARD_BREAKPOINTS[bp];
    const seen = new Set<string>();
    const items: LayoutItem[] = [];
    for (const item of layout?.[bp] ?? []) {
      if (!ids.has(item.i) || seen.has(item.i)) continue;
      seen.add(item.i);
      items.push({ ...item });
    }
    let y = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    let x = 0;
    let rowH = 0;
    for (const w of widgets) {
      if (seen.has(w.id)) continue;
      const size = WIDGET_SIZES[w.type];
      const width = bp === 'sm' ? 1 : Math.min(size.w, cols);
      if (x + width > cols) {
        y += rowH;
        x = 0;
        rowH = 0;
      }
      items.push({
        i: w.id,
        x,
        y,
        w: width,
        h: size.h,
        minW: Math.min(size.minW, width),
        minH: size.minH,
      });
      x += width;
      rowH = Math.max(rowH, size.h);
    }
    out[bp] = items;
  }
  return out;
}

/** Dashboards, shares, threads and change sets in SQLite (F18 §6). Synchronous; tiny rows. */
export class Dashboards {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
    private readonly accounts: Accounts,
    private readonly tree: FleetTree,
  ) {}

  // ---- reads ----

  list(userId: string): DashboardList {
    const mineRows = this.db
      .prepare(
        `SELECT id, owner_id, title, description, json_array_length(widgets) AS n, version, updated_at
         FROM dashboards WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(userId) as unknown as (Omit<DashRow, 'widgets' | 'layout'> & { n: number })[];
    const shareCounts = new Map<string, number>();
    const shareRows = this.db
      .prepare(
        `SELECT s.dashboard_id AS d, s.user_id AS u FROM dashboard_shares s
         JOIN dashboards x ON x.id = s.dashboard_id WHERE x.owner_id = ?`,
      )
      .all(userId) as unknown as { d: string; u: string }[];
    for (const r of shareRows)
      if (this.accounts.users.has(r.u)) shareCounts.set(r.d, (shareCounts.get(r.d) ?? 0) + 1);
    const sharedRows = this.db
      .prepare(
        `SELECT d.id, d.owner_id, d.title, d.description, json_array_length(d.widgets) AS n,
                d.version, d.updated_at
         FROM dashboard_shares s JOIN dashboards d ON d.id = s.dashboard_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC, d.rowid DESC`,
      )
      .all(userId) as unknown as (Omit<DashRow, 'widgets' | 'layout'> & { n: number })[];
    const summary = (
      r: Omit<DashRow, 'widgets' | 'layout'> & { n: number },
      access: 'owner' | 'viewer',
    ): DashboardSummary => ({
      id: r.id,
      ownerId: r.owner_id,
      ownerName: this.ownerName(r.owner_id),
      title: r.title,
      description: r.description,
      widgetCount: r.n,
      version: r.version,
      updatedAt: r.updated_at,
      access,
      shareCount: access === 'owner' ? (shareCounts.get(r.id) ?? 0) : 0,
    });
    return {
      mine: mineRows.map((r) => summary(r, 'owner')),
      sharedWithMe: sharedRows.map((r) => summary(r, 'viewer')),
    };
  }

  /** `404` unless the user owns the dashboard or it is shared with them. */
  get(userId: string, id: string): Dashboard {
    const row = this.row(id);
    if (row.owner_id === userId) return this.toDto(row, 'owner');
    if (this.isSharedWith(id, userId)) return this.toDto(row, 'viewer');
    throw notFound();
  }

  // ---- owner writes ----

  create(ownerId: string, body: CreateDashboardBody): Dashboard {
    const input = parse(createDashboardBodySchema, body);
    if (input.layout) this.checkExplicitLayout(input.widgets ?? [], input.layout);
    return transaction(this.db, () => {
      this.requireBelowLimit(ownerId);
      const content = this.commitContent(ownerId, [], {
        title: input.title ?? DEFAULT_DASHBOARD_TITLE,
        description: input.description ?? '',
        widgets: input.widgets ?? [],
        layout: input.layout ?? { lg: [], md: [], sm: [] },
      });
      return this.insert(ownerId, content);
    });
  }

  update(ownerId: string, id: string, body: UpdateDashboardBody): Dashboard {
    const input = parse(updateDashboardBodySchema, body);
    return transaction(this.db, () => {
      const row = this.requireOwned(ownerId, id);
      this.requireVersion(row, input.version);
      const prev = this.content(row);
      const widgets = input.widgets ?? prev.widgets;
      if (input.layout) this.checkExplicitLayout(widgets, input.layout);
      const content = this.commitContent(ownerId, prev.widgets, {
        title: input.title ?? prev.title,
        description: input.description ?? prev.description,
        widgets,
        layout: input.layout ?? prev.layout,
      });
      return this.write(row, content);
    });
  }

  duplicate(userId: string, id: string, title?: string): Dashboard {
    const source = this.get(userId, id);
    const name = (title ?? `${source.title} (copy)`).slice(0, DASHBOARD_TITLE_MAX).trim();
    return transaction(this.db, () => {
      this.requireBelowLimit(userId);
      const content = this.commitContent(userId, [], {
        title: name || DEFAULT_DASHBOARD_TITLE,
        description: source.description,
        widgets: source.widgets,
        layout: source.layout,
      });
      return this.insert(userId, content);
    });
  }

  remove(ownerId: string, id: string): void {
    this.requireOwned(ownerId, id);
    this.db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
  }

  // ---- sharing ----

  shares(ownerId: string, id: string): DashboardShare[] {
    this.requireOwned(ownerId, id);
    return this.shareList(id);
  }

  addShares(ownerId: string, id: string, userIds: readonly string[]): DashboardShare[] {
    const owner = this.accounts.user(ownerId);
    this.requireOwned(ownerId, id);
    const candidates = new Set(this.candidates(owner).map((u) => u.id));
    const wanted = [...new Set(userIds)];
    const bad = wanted
      .filter((u) => u === ownerId || !candidates.has(u))
      .map((userId) => ({ userId, reason: userId === ownerId ? 'self' : 'not_a_candidate' }));
    if (bad.length)
      throw new HttpError(422, 'validation_failed', 'Some users cannot be shared with', bad);
    return transaction(this.db, () => {
      const existing = new Set(
        (
          this.db
            .prepare('SELECT user_id AS u FROM dashboard_shares WHERE dashboard_id = ?')
            .all(id) as unknown as { u: string }[]
        ).map((r) => r.u),
      );
      const added = wanted.filter((u) => !existing.has(u));
      if (existing.size + added.length > SHARES_PER_DASHBOARD)
        throw new HttpError(
          409,
          'share_limit',
          `A dashboard can be shared with at most ${SHARES_PER_DASHBOARD} users`,
        );
      const insert = this.db.prepare(
        'INSERT INTO dashboard_shares (dashboard_id, user_id, shared_by, created_at) VALUES (?, ?, ?, ?)',
      );
      const now = this.clock.now();
      for (const u of added) insert.run(id, u, ownerId, now);
      return this.shareList(id);
    });
  }

  revokeShare(ownerId: string, id: string, userId: string): void {
    this.requireOwned(ownerId, id);
    this.db
      .prepare('DELETE FROM dashboard_shares WHERE dashboard_id = ? AND user_id = ?')
      .run(id, userId);
  }

  /** Active `dashboards.use` users (≠ caller) whose fleet scope overlaps the caller's; ≤ 50. */
  shareCandidates(user: User, q?: string): ShareCandidate[] {
    const needle = q?.trim().toLowerCase() ?? '';
    return this.candidates(user)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
      .map((u) => ({ userId: u.id, name: u.name, email: u.email }));
  }

  // ---- thread & change sets (F19) ----

  thread(ownerId: string, id: string): DashboardThread {
    const row = this.requireOwned(ownerId, id);
    const changes = this.changeSets(row);
    const rows = this.db
      .prepare(
        'SELECT id, seq, role, text, chips, change_id, created_at FROM dashboard_messages WHERE dashboard_id = ? ORDER BY seq',
      )
      .all(id) as unknown as MessageRow[];
    return { messages: rows.map((m) => this.toMessage(m, changes)) };
  }

  /** Appends one turn; `seq` increases per dashboard and the thread is pruned to 200. */
  appendMessage(ownerId: string, id: string, msg: AppendMessage): ThreadMessage {
    const input = parse(appendMessageSchema, msg);
    return transaction(this.db, () => {
      const row = this.requireOwned(ownerId, id);
      if (input.changeId && !this.changeRow(id, input.changeId))
        throw new HttpError(422, 'validation_failed', `Unknown change ${input.changeId}`);
      const { s } = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM dashboard_messages WHERE dashboard_id = ?')
        .get(id) as { s: number };
      const message: MessageRow = {
        id: `msg-${randomUUID()}`,
        seq: s + 1,
        role: input.role,
        text: input.text,
        chips: JSON.stringify(input.chips satisfies ToolChip[]),
        change_id: input.changeId ?? null,
        created_at: this.clock.now(),
      };
      this.db
        .prepare(
          'INSERT INTO dashboard_messages (id, dashboard_id, seq, role, text, chips, change_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          message.id,
          id,
          message.seq,
          message.role,
          message.text,
          message.chips,
          message.change_id,
          message.created_at,
        );
      this.db
        .prepare('DELETE FROM dashboard_messages WHERE dashboard_id = ? AND seq <= ?')
        .run(id, message.seq - THREAD_MESSAGES_MAX);
      return this.toMessage(message, this.changeSets(row));
    });
  }

  /**
   * One assistant turn in one transaction: snapshot, `mutate(draft)`, validate + normalise,
   * write `version + 1` and one change set. Throws 409 `version_conflict` on a stale version.
   */
  applyTurn(
    ownerId: string,
    id: string,
    expectedVersion: number,
    summary: string,
    mutate: (draft: DashboardDraft) => void,
  ): { dashboard: Dashboard; change: ChangeSet } {
    return transaction(this.db, () => {
      const row = this.requireOwned(ownerId, id);
      this.requireVersion(row, expectedVersion);
      const before = this.content(row);
      const draft: DashboardDraft = structuredClone(before);
      mutate(draft);
      const parsed = parse(draftSchema, draft);
      const content = this.commitContent(ownerId, before.widgets, parsed);
      const dashboard = this.write(row, content);
      const change: ChangeRow = {
        id: `chg-${randomUUID()}`,
        dashboard_id: id,
        summary: summary.slice(0, 500),
        before: JSON.stringify(before),
        before_version: row.version,
        after_version: dashboard.version,
        undone_at: null,
        created_at: this.clock.now(),
      };
      this.db
        .prepare(
          'INSERT INTO dashboard_changes (id, dashboard_id, summary, before, before_version, after_version, undone_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
        )
        .run(
          change.id,
          id,
          change.summary,
          change.before,
          change.before_version,
          change.after_version,
          change.created_at,
        );
      this.db
        .prepare(
          `DELETE FROM dashboard_changes WHERE dashboard_id = ? AND id NOT IN (
             SELECT id FROM dashboard_changes WHERE dashboard_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        )
        .run(id, id, CHANGE_SETS_KEPT);
      return { dashboard, change: this.toChange(change, change.id, dashboard.version) };
    });
  }

  /** Restores the latest, not-yet-undone change set while nothing was edited after it. */
  undo(ownerId: string, id: string, changeId: string, expectedVersion: number): Dashboard {
    return transaction(this.db, () => {
      const row = this.requireOwned(ownerId, id);
      this.requireVersion(row, expectedVersion);
      const change = this.changeRow(id, changeId);
      if (!change) throw new HttpError(404, 'not_found', 'Change not found');
      const latest = this.latestChangeId(id);
      if (change.id !== latest || change.undone_at !== null || row.version !== change.after_version)
        throw new HttpError(409, 'not_undoable', 'Only the latest unedited change can be undone');
      const before = dashboardContentSchema.parse(JSON.parse(change.before));
      const dashboard = this.write(row, before);
      this.db
        .prepare('UPDATE dashboard_changes SET undone_at = ? WHERE id = ?')
        .run(this.clock.now(), change.id);
      return dashboard;
    });
  }

  // ---- internals ----

  private row(id: string): DashRow {
    const row = this.db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id) as
      DashRow | undefined;
    if (!row) throw notFound();
    return row;
  }

  private isSharedWith(id: string, userId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM dashboard_shares WHERE dashboard_id = ? AND user_id = ?')
      .get(id, userId);
  }

  /** Owner → the row; viewer → 403; anyone else → 404. */
  private requireOwned(ownerId: string, id: string): DashRow {
    const row = this.row(id);
    if (row.owner_id === ownerId) return row;
    if (this.isSharedWith(id, ownerId))
      throw new HttpError(403, 'forbidden', 'Only the owner can change this dashboard');
    throw notFound();
  }

  private requireVersion(row: DashRow, version: number) {
    if (row.version !== version)
      throw new HttpError(409, 'version_conflict', 'The dashboard was changed elsewhere', {
        currentVersion: row.version,
      });
  }

  private requireBelowLimit(ownerId: string) {
    const { n } = this.db
      .prepare('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?')
      .get(ownerId) as { n: number };
    if (n >= DASHBOARDS_PER_USER)
      throw new HttpError(
        409,
        'dashboard_limit',
        `You can own at most ${DASHBOARDS_PER_USER} dashboards`,
      );
  }

  private checkExplicitLayout(widgets: readonly WidgetInput[], layout: DashboardLayout) {
    const ids = widgets.map((w) => w.id).filter((x): x is string => !!x);
    const issues = layoutIssues(ids, layout).map((i) => ({ ...i, path: ['layout', ...i.path] }));
    if (issues.length) throw new HttpError(422, 'validation_failed', issues[0]!.message, issues);
  }

  /** Assigns widget ids, normalises the layout, validates, and checks the owner's permissions. */
  private commitContent(
    ownerId: string,
    prevWidgets: readonly Widget[],
    next: DashboardDraft,
  ): DashboardContent {
    const used = new Set(next.widgets.map((w) => w.id).filter(Boolean));
    const widgets = next.widgets.map((w) => {
      if (w.id) return w;
      let wid = newWidgetId();
      while (used.has(wid)) wid = newWidgetId();
      used.add(wid);
      return { ...w, id: wid };
    }) as Widget[];
    const content = parse(dashboardContentSchema, {
      title: next.title,
      description: next.description.slice(0, DASHBOARD_DESCRIPTION_MAX),
      widgets,
      layout: normaliseLayout(widgets, next.layout),
    });
    const owner = this.accounts.users.get(ownerId);
    const granted = new Set<Permission>(owner ? this.accounts.permissions(owner) : []);
    const prev = new Map(prevWidgets.map((w) => [w.id, JSON.stringify(w)]));
    const missing = content.widgets
      .filter((w) => prev.get(w.id) !== JSON.stringify(w))
      .map((w) => ({ widgetId: w.id, permission: widgetPermission(w) }))
      .filter(
        (m): m is { widgetId: string; permission: Permission } =>
          m.permission !== null && !granted.has(m.permission),
      );
    if (missing.length)
      throw new HttpError(
        422,
        'widget_not_permitted',
        `You don't have access to the data of widget ${missing[0]!.widgetId}`,
        missing,
      );
    return content;
  }

  private insert(ownerId: string, content: DashboardContent): Dashboard {
    const now = this.clock.now();
    const row: DashRow = {
      id: `dash-${randomUUID()}`,
      owner_id: ownerId,
      title: content.title,
      description: content.description,
      widgets: JSON.stringify(content.widgets),
      layout: JSON.stringify(content.layout),
      version: 1,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        'INSERT INTO dashboards (id, owner_id, title, description, widgets, layout, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.owner_id,
        row.title,
        row.description,
        row.widgets,
        row.layout,
        row.version,
        row.created_at,
        row.updated_at,
      );
    return this.toDto(row, 'owner');
  }

  /** Content edit: `version + 1`, `updatedAt` = now (guarded by the version it was read at). */
  private write(row: DashRow, content: DashboardContent): Dashboard {
    const next: DashRow = {
      ...row,
      title: content.title,
      description: content.description,
      widgets: JSON.stringify(content.widgets),
      layout: JSON.stringify(content.layout),
      version: row.version + 1,
      updated_at: this.clock.now(),
    };
    const res = this.db
      .prepare(
        'UPDATE dashboards SET title = ?, description = ?, widgets = ?, layout = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      )
      .run(
        next.title,
        next.description,
        next.widgets,
        next.layout,
        next.version,
        next.updated_at,
        row.id,
        row.version,
      );
    if (Number(res.changes) !== 1) {
      throw new HttpError(409, 'version_conflict', 'The dashboard was changed elsewhere', {
        currentVersion: this.row(row.id).version,
      });
    }
    return this.toDto(next, 'owner');
  }

  private content(row: DashRow): DashboardContent {
    return {
      title: row.title,
      description: row.description,
      widgets: JSON.parse(row.widgets) as Widget[],
      layout: JSON.parse(row.layout) as DashboardLayout,
    };
  }

  private toDto(row: DashRow, access: 'owner' | 'viewer'): Dashboard {
    return {
      id: row.id,
      ownerId: row.owner_id,
      ownerName: this.ownerName(row.owner_id),
      ...this.content(row),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      access,
    };
  }

  private ownerName(id: string) {
    return this.accounts.users.get(id)?.name ?? FORMER_USER;
  }

  private shareList(id: string): DashboardShare[] {
    const rows = this.db
      .prepare(
        'SELECT user_id AS u, created_at AS t FROM dashboard_shares WHERE dashboard_id = ? ORDER BY created_at, user_id',
      )
      .all(id) as unknown as { u: string; t: number }[];
    return rows.flatMap((r) => {
      const u = this.accounts.users.get(r.u);
      return u ? [{ userId: u.id, name: u.name, email: u.email, sharedAt: r.t }] : [];
    });
  }

  private candidates(user: User) {
    return [...this.accounts.users.values()].filter(
      (u) =>
        u.id !== user.id &&
        u.status === 'active' &&
        this.accounts.permissions(u).includes('dashboards.use') &&
        this.overlaps(user.fleetIds, u.fleetIds),
    );
  }

  /** One user's granted fleet lies in the other's subtree (either way). */
  private overlaps(a: readonly string[], b: readonly string[]) {
    return a.some((x) => this.tree.inScope(x, b)) || b.some((y) => this.tree.inScope(y, a));
  }

  private changeRow(id: string, changeId: string): ChangeRow | undefined {
    return this.db
      .prepare('SELECT * FROM dashboard_changes WHERE id = ? AND dashboard_id = ?')
      .get(changeId, id) as ChangeRow | undefined;
  }

  private latestChangeId(id: string): string | undefined {
    const r = this.db
      .prepare(
        'SELECT id FROM dashboard_changes WHERE dashboard_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(id) as { id: string } | undefined;
    return r?.id;
  }

  private changeSets(row: DashRow): Map<string, ChangeSet> {
    const rows = this.db
      .prepare('SELECT * FROM dashboard_changes WHERE dashboard_id = ?')
      .all(row.id) as unknown as ChangeRow[];
    const latest = this.latestChangeId(row.id);
    return new Map(rows.map((c) => [c.id, this.toChange(c, latest, row.version)]));
  }

  private toChange(c: ChangeRow, latestId: string | undefined, version: number): ChangeSet {
    return {
      id: c.id,
      summary: c.summary,
      beforeVersion: c.before_version,
      afterVersion: c.after_version,
      undoneAt: c.undone_at,
      undoable: c.id === latestId && c.undone_at === null && version === c.after_version,
    };
  }

  private toMessage(m: MessageRow, changes: Map<string, ChangeSet>): ThreadMessage {
    return {
      id: m.id,
      seq: m.seq,
      role: m.role,
      text: m.text,
      chips: JSON.parse(m.chips) as ToolChip[],
      change: (m.change_id && changes.get(m.change_id)) || null,
      createdAt: m.created_at,
    };
  }
}
