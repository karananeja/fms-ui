import {
  BREAKPOINT_IDS,
  DASHBOARD_ACTIVITY_MAX,
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
  type DashboardAccess,
  type DashboardActivity,
  type DashboardContent,
  type DashboardLayout,
  type DashboardList,
  type DashboardShare,
  type DashboardSummary,
  type DashboardThread,
  type LayoutItem,
  type Permission,
  type ShareAccess,
  type ShareCandidate,
  type ThreadMessage,
  type ToolChip,
  type UpdateDashboardBody,
  type User,
  type Widget,
  type WidgetInput,
  type WidgetPreview,
  type WidgetPreviewStatus,
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
import { DashboardSnapshots, type SnapshotMime } from './dashboard-snapshots.ts';

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
  /** F27: last content editor (`null` only for rows written before F27 without a backfill). */
  updated_by: string | null;
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
  /** F27 (D-151): who made the change set; only they can undo it. */
  actor_id: string | null;
}
interface ActivityRow {
  id: string;
  user_id: string;
  summary: string;
  version: number;
  change_id: string | null;
  manual: number;
  at: number;
}

/** F27 (D-152): manual saves by the same person within this window share one activity row. */
export const ACTIVITY_COALESCE_MS = 2 * 60_000;

/** F27 (D-153): what the live hub pushes; emitted after the write committed. */
export type DashboardStoreEvent =
  | {
      type: 'changed';
      dashboardId: string;
      version: number;
      by: { userId: string; name: string };
      at: number;
      summary: string;
    }
  | {
      type: 'access';
      dashboardId: string;
      userId: string;
      access: 'editor' | 'viewer' | null;
    }
  | { type: 'deleted'; dashboardId: string };
interface MessageRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  chips: string;
  change_id: string | null;
  previews_json: string;
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

const toAccess = (share: ShareAccess) => (share === 'edit' ? 'editor' : 'viewer');

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** F27 (D-152): a short activity line for a manual save (no widget contents). */
export function describeEdit(prev: DashboardContent, next: DashboardContent): string {
  const parts: string[] = [];
  if (prev.title !== next.title) parts.push(`Renamed to “${next.title}”`);
  if (prev.description !== next.description) parts.push('Edited the description');
  const before = new Map(prev.widgets.map((w) => [w.id, JSON.stringify(w)]));
  const after = new Set(next.widgets.map((w) => w.id));
  const added = next.widgets.filter((w) => !before.has(w.id)).length;
  const removed = prev.widgets.filter((w) => !after.has(w.id)).length;
  const edited = next.widgets.filter(
    (w) => before.has(w.id) && before.get(w.id) !== JSON.stringify(w),
  ).length;
  if (added) parts.push(`Added ${plural(added, 'widget')}`);
  if (removed) parts.push(`Removed ${plural(removed, 'widget')}`);
  if (edited) parts.push(`Edited ${plural(edited, 'widget')}`);
  if (!parts.length && JSON.stringify(prev.layout) !== JSON.stringify(next.layout))
    parts.push('Rearranged widgets');
  return parts.join('; ') || 'Saved';
}

/** Merges two manual-save lines (distinct parts, original order). */
function mergeSummaries(a: string, b: string): string {
  const parts = [...new Set([...a.split('; '), ...b.split('; ')])].filter((p) => p !== 'Saved');
  return (parts.join('; ') || 'Saved').slice(0, 200);
}

/** Dashboards, shares, threads and change sets in SQLite (F18 §6). Synchronous; tiny rows. */
export class Dashboards {
  /** D-142: per-viewer list-card snapshots (rows cascade with the dashboard). */
  readonly snapshots: DashboardSnapshots;
  /** F27 (D-153): set by `buildServer` to push changes over the live hub. */
  onEvent: ((e: DashboardStoreEvent) => void) | null = null;
  private queued: DashboardStoreEvent[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
    private readonly accounts: Accounts,
    private readonly tree: FleetTree,
  ) {
    this.snapshots = new DashboardSnapshots(db, clock);
  }

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
                d.version, d.updated_at, s.access AS share_access
         FROM dashboard_shares s JOIN dashboards d ON d.id = s.dashboard_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC, d.rowid DESC`,
      )
      .all(userId) as unknown as (Omit<DashRow, 'widgets' | 'layout'> & {
      n: number;
      share_access: ShareAccess;
    })[];
    const snaps = this.snapshots.metaFor(
      userId,
      [...mineRows, ...sharedRows].map((r) => r.id),
    );
    const summary = (
      r: Omit<DashRow, 'widgets' | 'layout'> & { n: number },
      access: DashboardAccess,
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
      snapshot: snaps.get(r.id) ?? null,
    });
    return {
      mine: mineRows.map((r) => summary(r, 'owner')),
      sharedWithMe: sharedRows.map((r) => summary(r, toAccess(r.share_access))),
    };
  }

  /** `404` unless the user owns the dashboard or it is shared with them. */
  get(userId: string, id: string): Dashboard {
    const row = this.row(id);
    const access = this.accessTo(row, userId);
    if (!access) throw notFound();
    return this.toDto(row, access);
  }

  /** F27: the caller's access, or `null` (no row, not shared). Never throws. */
  accessOf(userId: string, id: string): DashboardAccess | null {
    const row = this.db.prepare('SELECT id, owner_id FROM dashboards WHERE id = ?').get(id) as
      Pick<DashRow, 'id' | 'owner_id'> | undefined;
    return row ? this.accessTo(row, userId) : null;
  }

  /** F27 (D-152): who changed what, newest first (≤ 20; any access). */
  activity(userId: string, id: string): DashboardActivity {
    this.get(userId, id);
    const rows = this.db
      .prepare(
        'SELECT * FROM dashboard_activity WHERE dashboard_id = ? ORDER BY at DESC, rowid DESC LIMIT ?',
      )
      .all(id, DASHBOARD_ACTIVITY_MAX) as unknown as ActivityRow[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: this.ownerName(r.user_id),
        summary: r.summary,
        version: r.version,
        at: r.at,
      })),
    };
  }

  // ---- owner and editor writes ----

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

  /** Owner or editor (F27); `widget_not_permitted` is checked against `actorId`. */
  update(actorId: string, id: string, body: UpdateDashboardBody): Dashboard {
    const input = parse(updateDashboardBodySchema, body);
    return this.tx(() => {
      const row = this.requireEditable(actorId, id);
      this.requireVersion(row, input.version);
      const prev = this.content(row);
      const widgets = input.widgets ?? prev.widgets;
      if (input.layout) this.checkExplicitLayout(widgets, input.layout);
      const content = this.commitContent(actorId, prev.widgets, {
        title: input.title ?? prev.title,
        description: input.description ?? prev.description,
        widgets,
        layout: input.layout ?? prev.layout,
      });
      const summary = describeEdit(prev, content);
      const dashboard = this.write(row, content, actorId, summary);
      this.record(id, actorId, summary, dashboard.version, { manual: true });
      return dashboard;
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
    this.tx(() => {
      this.requireOwned(ownerId, id);
      this.db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
      this.queued.push({ type: 'deleted', dashboardId: id });
    });
  }

  // ---- sharing ----

  shares(ownerId: string, id: string): DashboardShare[] {
    this.requireOwned(ownerId, id);
    return this.shareList(id);
  }

  addShares(
    ownerId: string,
    id: string,
    userIds: readonly string[],
    access: ShareAccess = 'view',
  ): DashboardShare[] {
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
        'INSERT INTO dashboard_shares (dashboard_id, user_id, shared_by, created_at, access) VALUES (?, ?, ?, ?, ?)',
      );
      const now = this.clock.now();
      for (const u of added) insert.run(id, u, ownerId, now, access);
      return this.shareList(id);
    });
  }

  /**
   * F27 (D-150): changes one person's level (owner only; 404 if not shared). A downgrade to
   * `view` deletes that person's chat on the dashboard (D-151). Applies at once.
   */
  setShareAccess(
    ownerId: string,
    id: string,
    userId: string,
    access: ShareAccess,
  ): DashboardShare[] {
    return this.tx(() => {
      this.requireOwned(ownerId, id);
      const res = this.db
        .prepare('UPDATE dashboard_shares SET access = ? WHERE dashboard_id = ? AND user_id = ?')
        .run(access, id, userId);
      if (Number(res.changes) !== 1) throw new HttpError(404, 'not_found', 'Share not found');
      if (access === 'view') this.deleteThread(id, userId);
      this.queued.push({ type: 'access', dashboardId: id, userId, access: toAccess(access) });
      return this.shareList(id);
    });
  }

  revokeShare(ownerId: string, id: string, userId: string): void {
    this.tx(() => {
      this.requireOwned(ownerId, id);
      const res = this.db
        .prepare('DELETE FROM dashboard_shares WHERE dashboard_id = ? AND user_id = ?')
        .run(id, userId);
      if (userId === ownerId) return;
      // D-142: the viewer's snapshot holds their data view; it goes with the share.
      this.snapshots.remove(id, userId);
      // F27 (D-151): so does their private chat on this dashboard.
      this.deleteThread(id, userId);
      if (Number(res.changes) === 1)
        this.queued.push({ type: 'access', dashboardId: id, userId, access: null });
    });
  }

  /** D-142: the caller's own snapshot; any access (owner or viewer), else 404. */
  snapshot(userId: string, id: string) {
    this.get(userId, id);
    return this.snapshots.get(id, userId);
  }

  putSnapshot(
    userId: string,
    id: string,
    mime: SnapshotMime,
    image: Uint8Array,
    theme: 'light' | 'dark',
  ) {
    this.get(userId, id);
    return this.snapshots.put(id, userId, mime, image, theme);
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

  /** F27 (D-151): the caller's own thread on the dashboard (owner or editor). */
  thread(userId: string, id: string): DashboardThread {
    const row = this.requireEditable(userId, id);
    const changes = this.changeSets(row, userId);
    const rows = this.db
      .prepare(
        'SELECT id, seq, role, text, chips, change_id, previews_json, created_at FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ? ORDER BY seq',
      )
      .all(id, userId) as unknown as MessageRow[];
    return { messages: rows.map((m) => this.toMessage(m, changes)) };
  }

  /**
   * Appends one turn to the caller's thread; `seq` increases per dashboard (all threads) and
   * each person's thread is pruned to 200.
   */
  appendMessage(userId: string, id: string, msg: AppendMessage): ThreadMessage {
    const input = parse(appendMessageSchema, msg);
    return transaction(this.db, () => {
      const row = this.requireEditable(userId, id);
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
        previews_json: JSON.stringify(input.previews satisfies WidgetPreview[]),
        created_at: this.clock.now(),
      };
      this.db
        .prepare(
          'INSERT INTO dashboard_messages (id, dashboard_id, seq, role, text, chips, change_id, previews_json, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          message.id,
          id,
          message.seq,
          message.role,
          message.text,
          message.chips,
          message.change_id,
          message.previews_json,
          message.created_at,
          userId,
        );
      this.db
        .prepare(
          `DELETE FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ? AND seq <= (
             SELECT seq FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ?
             ORDER BY seq DESC LIMIT 1 OFFSET ?)`,
        )
        .run(id, userId, id, userId, THREAD_MESSAGES_MAX);
      return this.toMessage(message, this.changeSets(row, userId));
    });
  }

  /**
   * D-135: records a preview card's state (`added` / `discarded`) on its thread message. Owner
   * only (shared → 403, else 404); 404 for an unknown preview. Adding the widget is a separate
   * dashboard PATCH by the client.
   */
  setPreviewStatus(
    userId: string,
    id: string,
    previewId: string,
    status: WidgetPreviewStatus,
  ): WidgetPreview {
    return transaction(this.db, () => {
      this.requireEditable(userId, id);
      const rows = this.db
        .prepare(
          "SELECT id, previews_json FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ? AND previews_json <> '[]'",
        )
        .all(id, userId) as unknown as Pick<MessageRow, 'id' | 'previews_json'>[];
      for (const r of rows) {
        const previews = JSON.parse(r.previews_json) as WidgetPreview[];
        const p = previews.find((x) => x.id === previewId);
        if (!p) continue;
        p.status = status;
        this.db
          .prepare('UPDATE dashboard_messages SET previews_json = ? WHERE id = ?')
          .run(JSON.stringify(previews), r.id);
        return p;
      }
      throw new HttpError(404, 'not_found', 'Preview not found');
    });
  }

  /**
   * One assistant tool call in one transaction: snapshot, `mutate(draft)`, validate + normalise,
   * write `version + 1` and record a change set. Throws 409 `version_conflict` on a stale version.
   *
   * F19 §6 `extend`: when that change set is still the latest, not undone and nothing was written
   * after it (`version === after_version`), it is extended (new `after_version` and `summary`,
   * same `before` snapshot) instead of inserting a new one. `summary` may be a function of
   * whether it extends.
   */
  applyTurn(
    actorId: string,
    id: string,
    expectedVersion: number,
    summary: string | ((extending: boolean) => string),
    mutate: (draft: DashboardDraft) => void,
    opts: { extend?: string } = {},
  ): { dashboard: Dashboard; change: ChangeSet; extended: boolean } {
    return this.tx(() => {
      const row = this.requireEditable(actorId, id);
      this.requireVersion(row, expectedVersion);
      const prior = opts.extend ? this.changeRow(id, opts.extend) : undefined;
      const extending =
        !!prior &&
        prior.id === this.latestChangeId(id) &&
        prior.undone_at === null &&
        prior.actor_id === actorId &&
        row.version === prior.after_version;
      const text = (typeof summary === 'function' ? summary(extending) : summary).slice(0, 500);
      const before = this.content(row);
      const draft: DashboardDraft = structuredClone(before);
      mutate(draft);
      const parsed = parse(draftSchema, draft);
      const content = this.commitContent(actorId, before.widgets, parsed);
      const dashboard = this.write(row, content, actorId, text);
      if (extending) {
        const change: ChangeRow = { ...prior, summary: text, after_version: dashboard.version };
        this.db
          .prepare('UPDATE dashboard_changes SET summary = ?, after_version = ? WHERE id = ?')
          .run(change.summary, change.after_version, change.id);
        this.record(id, actorId, text, dashboard.version, { changeId: change.id });
        return {
          dashboard,
          change: this.toChange(change, change.id, dashboard.version, actorId),
          extended: true,
        };
      }
      const change: ChangeRow = {
        id: `chg-${randomUUID()}`,
        dashboard_id: id,
        summary: text,
        before: JSON.stringify(before),
        before_version: row.version,
        after_version: dashboard.version,
        undone_at: null,
        created_at: this.clock.now(),
        actor_id: actorId,
      };
      this.db
        .prepare(
          'INSERT INTO dashboard_changes (id, dashboard_id, summary, before, before_version, after_version, undone_at, created_at, actor_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
        )
        .run(
          change.id,
          id,
          change.summary,
          change.before,
          change.before_version,
          change.after_version,
          change.created_at,
          actorId,
        );
      this.record(id, actorId, text, dashboard.version, { changeId: change.id });
      this.db
        .prepare(
          `DELETE FROM dashboard_changes WHERE dashboard_id = ? AND id NOT IN (
             SELECT id FROM dashboard_changes WHERE dashboard_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        )
        .run(id, id, CHANGE_SETS_KEPT);
      return {
        dashboard,
        change: this.toChange(change, change.id, dashboard.version, actorId),
        extended: false,
      };
    });
  }

  /**
   * Restores the latest, not-yet-undone change set while nothing was edited after it; F27
   * (D-151): only the person who made it can undo it.
   */
  undo(actorId: string, id: string, changeId: string, expectedVersion: number): Dashboard {
    return this.tx(() => {
      const row = this.requireEditable(actorId, id);
      this.requireVersion(row, expectedVersion);
      const change = this.changeRow(id, changeId);
      if (!change) throw new HttpError(404, 'not_found', 'Change not found');
      const latest = this.latestChangeId(id);
      if (change.id !== latest || change.undone_at !== null || row.version !== change.after_version)
        throw new HttpError(409, 'not_undoable', 'Only the latest unedited change can be undone');
      if (change.actor_id !== actorId)
        throw new HttpError(409, 'not_undoable', 'Only the person who made a change can undo it');
      const before = dashboardContentSchema.parse(JSON.parse(change.before));
      const summary = `Undid: ${change.summary}`.slice(0, 500);
      const dashboard = this.write(row, before, actorId, summary);
      this.db
        .prepare('UPDATE dashboard_changes SET undone_at = ? WHERE id = ?')
        .run(this.clock.now(), change.id);
      this.record(id, actorId, summary, dashboard.version);
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

  private shareAccess(id: string, userId: string): ShareAccess | null {
    const r = this.db
      .prepare('SELECT access FROM dashboard_shares WHERE dashboard_id = ? AND user_id = ?')
      .get(id, userId) as { access: ShareAccess } | undefined;
    return r?.access ?? null;
  }

  private accessTo(row: Pick<DashRow, 'id' | 'owner_id'>, userId: string): DashboardAccess | null {
    if (row.owner_id === userId) return 'owner';
    const share = this.shareAccess(row.id, userId);
    return share ? toAccess(share) : null;
  }

  /** Owner → the row; shared (any level) → 403; anyone else → 404. */
  private requireOwned(ownerId: string, id: string): DashRow {
    const row = this.row(id);
    if (row.owner_id === ownerId) return row;
    if (this.shareAccess(id, ownerId))
      throw new HttpError(403, 'forbidden', 'Only the owner can do this');
    throw notFound();
  }

  /** F27: owner or editor → the row; viewer → 403; anyone else → 404. */
  private requireEditable(userId: string, id: string): DashRow {
    const row = this.row(id);
    if (row.owner_id === userId) return row;
    const share = this.shareAccess(id, userId);
    if (share === 'edit') return row;
    if (share === 'view') throw new HttpError(403, 'forbidden', 'You can only view this dashboard');
    throw notFound();
  }

  /** Runs `fn` in a transaction, then hands its queued events to `onEvent` (after COMMIT). */
  private tx<T>(fn: () => T): T {
    this.queued = [];
    let result: T;
    try {
      result = transaction(this.db, fn);
    } catch (err) {
      this.queued = [];
      throw err;
    }
    const events = this.queued;
    this.queued = [];
    for (const e of events) this.onEvent?.(e);
    return result;
  }

  private deleteThread(id: string, userId: string) {
    this.db
      .prepare('DELETE FROM dashboard_messages WHERE dashboard_id = ? AND user_id = ?')
      .run(id, userId);
  }

  /**
   * F27 (D-152): one activity row. An AI change set keeps one row (`changeId`); manual saves by
   * the same person within `ACTIVITY_COALESCE_MS` merge into their previous manual row.
   */
  private record(
    id: string,
    userId: string,
    summary: string,
    version: number,
    opts: { changeId?: string; manual?: boolean } = {},
  ) {
    const now = this.clock.now();
    const latest = this.db
      .prepare(
        'SELECT * FROM dashboard_activity WHERE dashboard_id = ? ORDER BY at DESC, rowid DESC LIMIT 1',
      )
      .get(id) as ActivityRow | undefined;
    const sameChange = !!opts.changeId && latest?.change_id === opts.changeId;
    const sameManual =
      !!opts.manual &&
      latest?.manual === 1 &&
      latest.user_id === userId &&
      now - latest.at <= ACTIVITY_COALESCE_MS;
    if (latest && (sameChange || sameManual)) {
      const text = sameManual ? mergeSummaries(latest.summary, summary) : summary;
      this.db
        .prepare('UPDATE dashboard_activity SET summary = ?, version = ?, at = ? WHERE id = ?')
        .run(text, version, now, latest.id);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO dashboard_activity (id, dashboard_id, user_id, summary, version, change_id, manual, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `act-${randomUUID()}`,
        id,
        userId,
        summary.slice(0, 200),
        version,
        opts.changeId ?? null,
        opts.manual ? 1 : 0,
        now,
      );
    this.db
      .prepare(
        `DELETE FROM dashboard_activity WHERE dashboard_id = ? AND id NOT IN (
           SELECT id FROM dashboard_activity WHERE dashboard_id = ?
           ORDER BY at DESC, rowid DESC LIMIT ?)`,
      )
      .run(id, id, DASHBOARD_ACTIVITY_MAX);
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

  /**
   * Assigns widget ids, normalises the layout, validates, and checks the acting user's
   * permissions on new or changed widgets (F27: the editor's, not the owner's).
   */
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
      updated_by: ownerId,
    };
    this.db
      .prepare(
        'INSERT INTO dashboards (id, owner_id, title, description, widgets, layout, version, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        row.updated_by,
      );
    return this.toDto(row, 'owner');
  }

  /**
   * Content edit by `actorId` (owner or editor): `version + 1`, `updatedAt` = now, guarded by
   * the version it was read at. Queues the F27 `changed` event.
   */
  private write(row: DashRow, content: DashboardContent, actorId: string, summary: string) {
    const next: DashRow = {
      ...row,
      title: content.title,
      description: content.description,
      widgets: JSON.stringify(content.widgets),
      layout: JSON.stringify(content.layout),
      version: row.version + 1,
      updated_at: this.clock.now(),
      updated_by: actorId,
    };
    const res = this.db
      .prepare(
        'UPDATE dashboards SET title = ?, description = ?, widgets = ?, layout = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?',
      )
      .run(
        next.title,
        next.description,
        next.widgets,
        next.layout,
        next.version,
        next.updated_at,
        actorId,
        row.id,
        row.version,
      );
    if (Number(res.changes) !== 1) {
      throw new HttpError(409, 'version_conflict', 'The dashboard was changed elsewhere', {
        currentVersion: this.row(row.id).version,
      });
    }
    this.queued.push({
      type: 'changed',
      dashboardId: row.id,
      version: next.version,
      by: { userId: actorId, name: this.ownerName(actorId) },
      at: next.updated_at,
      summary,
    });
    return this.toDto(next, this.accessTo(row, actorId) ?? 'viewer');
  }

  private content(row: DashRow): DashboardContent {
    return {
      title: row.title,
      description: row.description,
      widgets: JSON.parse(row.widgets) as Widget[],
      layout: JSON.parse(row.layout) as DashboardLayout,
    };
  }

  private toDto(row: DashRow, access: DashboardAccess): Dashboard {
    return {
      id: row.id,
      ownerId: row.owner_id,
      ownerName: this.ownerName(row.owner_id),
      ...this.content(row),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      access,
      lastEdit: row.updated_by
        ? { userId: row.updated_by, name: this.ownerName(row.updated_by), at: row.updated_at }
        : null,
    };
  }

  private ownerName(id: string) {
    return this.accounts.users.get(id)?.name ?? FORMER_USER;
  }

  private shareList(id: string): DashboardShare[] {
    const rows = this.db
      .prepare(
        'SELECT user_id AS u, created_at AS t, access AS a FROM dashboard_shares WHERE dashboard_id = ? ORDER BY created_at, user_id',
      )
      .all(id) as unknown as { u: string; t: number; a: ShareAccess }[];
    return rows.flatMap((r) => {
      const u = this.accounts.users.get(r.u);
      return u ? [{ userId: u.id, name: u.name, email: u.email, sharedAt: r.t, access: r.a }] : [];
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

  private changeSets(row: DashRow, viewerId: string): Map<string, ChangeSet> {
    const rows = this.db
      .prepare('SELECT * FROM dashboard_changes WHERE dashboard_id = ?')
      .all(row.id) as unknown as ChangeRow[];
    const latest = this.latestChangeId(row.id);
    return new Map(rows.map((c) => [c.id, this.toChange(c, latest, row.version, viewerId)]));
  }

  /** `undoable` for `viewerId`: the latest, unedited change and (F27) made by them. */
  private toChange(
    c: ChangeRow,
    latestId: string | undefined,
    version: number,
    viewerId: string,
  ): ChangeSet {
    return {
      id: c.id,
      summary: c.summary,
      beforeVersion: c.before_version,
      afterVersion: c.after_version,
      undoneAt: c.undone_at,
      undoable:
        c.id === latestId &&
        c.undone_at === null &&
        version === c.after_version &&
        c.actor_id === viewerId,
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
      previews: JSON.parse(m.previews_json || '[]') as WidgetPreview[],
      createdAt: m.created_at,
    };
  }
}
