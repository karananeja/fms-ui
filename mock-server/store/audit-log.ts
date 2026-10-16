import type { ActionArea, ActionRow, ActionTarget, AuditQuery } from '@shared/contract/index.ts';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Clock } from '../clock.ts';

/** One `audit_log` row as the F29 Activity page reads it (F25 rows have no area / links). */
export interface AuditRow {
  seq: number;
  at: number;
  actorId: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  area: ActionArea;
  actionId: string | null;
  threadId: string | null;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  undoneAt: number | null;
}

interface Row {
  seq: number;
  at: number;
  actor_id: string;
  action: string;
  target: string;
  details: string;
  area: string | null;
  action_id: string | null;
  thread_id: string | null;
  before_json: string | null;
  after_json: string | null;
  undone_at: number | null;
}

/** Details of an F29 row (`details` column). */
export interface ActionAuditDetails {
  summary: string;
  target: ActionTarget;
  dashboardId: string | null;
}

const SQL = {
  insert: `INSERT INTO audit_log (at, actor_id, action, target, details, area, action_id, thread_id,
    before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  markUndone:
    "UPDATE audit_log SET undone_at = ? WHERE action_id = ? AND undone_at IS NULL AND action NOT LIKE '%.undo'",
  actors: 'SELECT DISTINCT actor_id FROM audit_log',
} as const;

/** `{label: before}` / `{label: after}` maps of preview rows. */
export const rowsToMaps = (rows: readonly ActionRow[]) => ({
  before: Object.fromEntries(rows.map((r) => [r.label, r.before])),
  after: Object.fromEntries(rows.map((r) => [r.label, r.after])),
});

/**
 * F29 (D-167): the audit log behind the Activity page. Appends the assistant's confirmed actions
 * (and their Undo) next to the F25 AI-key entries and reads them back with filters, newest first.
 * Reads go to SQL (the log is append-mostly and paged).
 */
export class AuditLog {
  private readonly stmt: Record<keyof typeof SQL, StatementSync>;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    this.stmt = Object.fromEntries(
      Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]),
    ) as Record<keyof typeof SQL, StatementSync>;
  }

  /** Appends one action row (call inside the action's `atomic()`). Returns its `seq`. */
  append(entry: {
    actorId: string;
    action: string;
    area: ActionArea;
    target: ActionTarget;
    summary: string;
    actionId: string;
    threadId: string | null;
    dashboardId: string | null;
    before: Record<string, string | null>;
    after: Record<string, string | null>;
  }): number {
    const details: ActionAuditDetails = {
      summary: entry.summary,
      target: entry.target,
      dashboardId: entry.dashboardId,
    };
    const r = this.stmt.insert.run(
      this.clock.now(),
      entry.actorId,
      entry.action,
      entry.target.id,
      JSON.stringify(details),
      entry.area,
      entry.actionId,
      entry.threadId,
      JSON.stringify(entry.before),
      JSON.stringify(entry.after),
    );
    return Number(r.lastInsertRowid);
  }

  /** Marks the action's original row undone. */
  markUndone(actionId: string): void {
    this.stmt.markUndone.run(this.clock.now(), actionId);
  }

  actorIds(): string[] {
    return (this.stmt.actors.all() as { actor_id: string }[]).map((r) => r.actor_id);
  }

  /** Newest first; `limit` rows matching the filters (`before` = cursor on `seq`). */
  query(q: AuditQuery, limit: number): AuditRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.user) {
      where.push('actor_id = ?');
      args.push(q.user);
    }
    if (q.area) {
      where.push("COALESCE(area, 'settings') = ?");
      args.push(q.area);
    }
    if (q.kind) {
      where.push('(action = ? OR action = ?)');
      args.push(q.kind, `${q.kind}.undo`);
    }
    if (q.from !== undefined) {
      where.push('at >= ?');
      args.push(q.from);
    }
    if (q.to !== undefined) {
      where.push('at <= ?');
      args.push(q.to);
    }
    if (q.before !== undefined) {
      where.push('seq < ?');
      args.push(q.before);
    }
    if (q.q) {
      const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        "(LOWER(action) LIKE ? ESCAPE '\\' OR LOWER(details) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(before_json, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(after_json, '')) LIKE ? ESCAPE '\\')",
      );
      args.push(like, like, like, like);
    }
    const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY seq DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, limit) as unknown as Row[];
    return rows.map((r) => ({
      seq: r.seq,
      at: r.at,
      actorId: r.actor_id,
      action: r.action,
      target: r.target,
      details: JSON.parse(r.details) as Record<string, unknown>,
      area: (r.area ?? 'settings') as ActionArea,
      actionId: r.action_id,
      threadId: r.thread_id,
      before: r.before_json ? (JSON.parse(r.before_json) as Record<string, string | null>) : {},
      after: r.after_json ? (JSON.parse(r.after_json) as Record<string, string | null>) : {},
      undoneAt: r.undone_at,
    }));
  }
}
