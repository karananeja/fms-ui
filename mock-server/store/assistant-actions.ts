import {
  ACTION_BATCH_MAX,
  ACTION_CARD_ROWS,
  AUDIT_PAGE_SIZE,
  DRIVER_STATUSES,
  PERMISSION_LABELS,
  PHONE_PATTERN,
  permissionSchema,
  SYSTEM_ONLY_PERMISSIONS,
  type ActionArea,
  type ActionCard,
  type ActionKind,
  type ActionRow,
  type ActionStatus,
  type ActionTarget,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
  type Permission,
  type User,
} from '@shared/contract/index.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { vehicleByRegno } from '../assistant/tool-kit.ts';
import { requireFleetInScope, requireVehicleInScope, type MockContext } from '../context.ts';
import { atomic } from '../db/database.ts';
import type { FleetNode } from '../generator/fleet-tree.ts';
import { HttpError } from '../http-error.ts';
import { requireDriverInScope } from '../routes/driver-routes.ts';
import { AuditLog, rowsToMaps, type ActionAuditDetails, type AuditRow } from './audit-log.ts';

/** A proposal can be confirmed for this long (spec §1). */
export const PROPOSAL_TTL_MS = 10 * 60_000;
/** Undo is offered this long after an action was done (D-168). */
export const UNDO_WINDOW_MS = 24 * 60 * 60_000;

/** Who acts: the user, their permissions and fleet scope (re-read on every step). */
interface Actor {
  user: User;
  perms: readonly Permission[];
  scope: readonly string[];
}

interface Plan<U> {
  target: ActionTarget;
  summary: string;
  /** Every before → after row (the card shows the first five). */
  rows: ActionRow[];
  /** Target state now; compared again on Confirm (`action_stale`). */
  state: unknown;
  /** Runs the change through the REST route's store function (inside `atomic()`). */
  run: () => { result?: string; target?: ActionTarget; undo?: U };
}

interface KindDef<S extends z.ZodType, U> {
  area: ActionArea;
  /** `null`: signed in is enough (the plan does its own check, e.g. share-link revoke). */
  permission: Permission | null;
  schema: S;
  plan: (a: Actor, p: z.infer<S>) => Plan<U>;
  /** Reversible kinds: the target state right after the action, and how to revert it. */
  undo?: { state: (data: U) => unknown; run: (a: Actor, data: U) => void };
}

interface AnyKind {
  area: ActionArea;
  permission: Permission | null;
  schema: z.ZodType;
  plan: (a: Actor, p: unknown) => Plan<unknown>;
  undo?: { state: (data: unknown) => unknown; run: (a: Actor, data: unknown) => void };
}

const def = <S extends z.ZodType, U = never>(d: KindDef<S, U>) => d as unknown as AnyKind;

interface Preview {
  summary: string;
  target: ActionTarget;
  rows: ActionRow[];
  undoable: boolean;
}
interface Outcome {
  result: string | null;
  error: string | null;
  target?: ActionTarget;
}
interface UndoState {
  data: unknown;
  /** Hash of the target state right after the action. */
  hash: string;
}

interface ActionDbRow {
  id: string;
  user_id: string;
  thread_id: string | null;
  dashboard_id: string | null;
  kind: ActionKind;
  params_json: string;
  preview_json: string;
  state_hash: string;
  status: ActionStatus;
  result_json: string | null;
  undo_json: string | null;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
  undone_at: number | null;
}

/** One stored proposal (its card is `card()`). */
export interface ActionRecord {
  id: string;
  userId: string;
  threadId: string | null;
  dashboardId: string | null;
  kind: ActionKind;
  params: unknown;
  preview: Preview;
  stateHash: string;
  status: ActionStatus;
  outcome: Outcome | null;
  undo: UndoState | null;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  undoneAt: number | null;
}

const hash = (state: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(state ?? null))
    .digest('base64url');

const SQL = {
  insert: `INSERT INTO assistant_actions (id, user_id, thread_id, dashboard_id, kind, params_json,
    preview_json, state_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  get: 'SELECT * FROM assistant_actions WHERE id = ?',
  decide: `UPDATE assistant_actions SET status = ?, result_json = ?, undo_json = ?, decided_at = ?
    WHERE id = ?`,
  undone: "UPDATE assistant_actions SET status = 'undone', undone_at = ? WHERE id = ?",
} as const;

const ref = z.string().trim().min(1);
const NONE = 'None';
const yesNo = (v: boolean) => (v ? 'On' : 'Off');

/**
 * F29 (D-166…D-168): actions the assistant proposes and the user confirms. `propose` validates,
 * checks `can()` and snapshots the target without changing anything; `confirm` re-checks the
 * permission and the snapshot, then runs the same store function (and scope rule) as the REST
 * route inside `atomic()` and writes an audit row; `undo` reverts reversible kinds within 24 h
 * while the target is unchanged. Proposals live in `assistant_actions` (no cache: low volume).
 */
export class AssistantActions {
  readonly audit: AuditLog;
  /** Called after Confirm / Cancel / Undo (F28 appends the result line to the thread). */
  readonly onDecided: ((action: ActionCard, record: ActionRecord, line: string) => void)[] = [];
  private readonly kinds: Record<ActionKind, AnyKind>;
  private readonly stmt: Record<keyof typeof SQL, ReturnType<MockContext['db']['prepare']>>;

  constructor(private readonly ctx: MockContext) {
    this.audit = new AuditLog(ctx.db, ctx.clock);
    this.stmt = Object.fromEntries(
      Object.entries(SQL).map(([k, sql]) => [k, ctx.db.prepare(sql)]),
    ) as typeof this.stmt;
    this.kinds = buildKinds(ctx);
  }

  /** Grants `audit.view` to the Super Admin system role of databases seeded before F29 (§5). */
  hydrate(): void {
    const { accounts } = this.ctx;
    for (const role of accounts.roles.values()) {
      if (
        role.system &&
        role.permissions.includes('roles.manage') &&
        !role.permissions.includes('audit.view')
      ) {
        // System roles can't be edited through the API; this is the one-off upgrade.
        accounts.updateRole(role.id, { permissions: [...role.permissions, 'audit.view'] });
      }
    }
  }

  private actor(userId: string): Actor {
    const user = this.ctx.accounts.users.get(userId);
    if (!user || user.status !== 'active')
      throw new HttpError(403, 'forbidden', 'User is disabled');
    return { user, perms: this.ctx.accounts.permissions(user), scope: user.fleetIds };
  }

  private requirePermission(a: Actor, k: AnyKind) {
    if (k.permission && !a.perms.includes(k.permission))
      throw new HttpError(403, 'forbidden', `Requires permission ${k.permission}`);
  }

  isKind(kind: string): kind is ActionKind {
    return kind in this.kinds;
  }

  /** The kind's input schema (the assistant tools reuse it). */
  schema(kind: ActionKind): z.ZodType {
    return this.kinds[kind].schema;
  }

  // ---- propose / confirm / cancel / undo ----

  /** Validates and stores a proposal; nothing changes. HttpError 403 / 404 / 409 / 422. */
  propose(
    user: User,
    input: {
      kind: ActionKind;
      params: unknown;
      threadId?: string | null;
      dashboardId?: string | null;
    },
  ): ActionCard {
    const k = this.kinds[input.kind];
    const a = this.actor(user.id);
    this.requirePermission(a, k);
    const parsed = k.schema.safeParse(input.params ?? {});
    if (!parsed.success)
      throw new HttpError(
        422,
        'validation_failed',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
        parsed.error.issues,
      );
    const plan = k.plan(a, parsed.data);
    const now = this.ctx.clock.now();
    const id = `act-${randomUUID()}`;
    const preview: Preview = {
      summary: plan.summary,
      target: plan.target,
      rows: plan.rows,
      undoable: !!k.undo,
    };
    this.stmt.insert.run(
      id,
      user.id,
      input.threadId ?? null,
      input.dashboardId ?? null,
      input.kind,
      JSON.stringify(parsed.data),
      JSON.stringify(preview),
      hash(plan.state),
      now,
      now + PROPOSAL_TTL_MS,
    );
    return this.card(this.require(id));
  }

  get(id: string): ActionRecord | undefined {
    const r = this.stmt.get.get(id) as unknown as ActionDbRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      userId: r.user_id,
      threadId: r.thread_id,
      dashboardId: r.dashboard_id,
      kind: r.kind,
      params: JSON.parse(r.params_json),
      preview: JSON.parse(r.preview_json) as Preview,
      stateHash: r.state_hash,
      status: r.status,
      outcome: r.result_json ? (JSON.parse(r.result_json) as Outcome) : null,
      undo: r.undo_json ? (JSON.parse(r.undo_json) as UndoState) : null,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      decidedAt: r.decided_at,
      undoneAt: r.undone_at,
    };
  }

  private require(id: string): ActionRecord {
    const r = this.get(id);
    if (!r) throw new HttpError(404, 'not_found', `Action ${id} not found`);
    return r;
  }

  /** The proposer's own proposal (`404` for anyone else, so ids don't leak). */
  private own(userId: string, id: string): ActionRecord {
    const r = this.get(id);
    if (!r || r.userId !== userId) throw new HttpError(404, 'not_found', `Action ${id} not found`);
    return r;
  }

  /** A `proposed` record, expiring it first when its time is up (`409 action_expired`). */
  private open(r: ActionRecord): void {
    if (r.status !== 'proposed')
      throw new HttpError(409, 'action_closed', `This action is already ${r.status}.`);
    if (r.expiresAt <= this.ctx.clock.now()) {
      this.setStatus(r, 'expired', { result: null, error: 'Expired. Ask again.' }, null);
      throw new HttpError(409, 'action_expired', 'Expired. Ask again.');
    }
  }

  private setStatus(
    r: ActionRecord,
    status: ActionStatus,
    outcome: Outcome,
    undo: UndoState | null,
  ) {
    const now = this.ctx.clock.now();
    this.stmt.decide.run(
      status,
      JSON.stringify(outcome),
      undo ? JSON.stringify(undo) : null,
      now,
      r.id,
    );
    r.status = status;
    r.outcome = outcome;
    r.undo = undo;
    r.decidedAt = now;
  }

  private notify(r: ActionRecord, line: string) {
    const card = this.card(r);
    for (const f of this.onDecided) f(card, r, line);
  }

  /** `POST /api/actions/:id/confirm` (spec §1.3). */
  confirm(user: User, id: string): ActionCard {
    const r = this.own(user.id, id);
    this.open(r);
    const k = this.kinds[r.kind];
    const a = this.actor(user.id);
    this.requirePermission(a, k);
    let plan: Plan<unknown>;
    try {
      plan = k.plan(a, r.params);
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) throw err;
      throw stale();
    }
    if (hash(plan.state) !== r.stateHash) throw stale();
    try {
      atomic(this.ctx.db, () => {
        const done = plan.run();
        const target = done.target ?? plan.target;
        const undo: UndoState | null =
          k.undo && done.undo !== undefined
            ? { data: done.undo, hash: hash(k.undo.state(done.undo)) }
            : null;
        const { before, after } = rowsToMaps(plan.rows);
        this.audit.append({
          actorId: user.id,
          action: r.kind,
          area: k.area,
          target,
          summary: plan.summary,
          actionId: r.id,
          threadId: r.threadId,
          dashboardId: r.dashboardId,
          before,
          after,
        });
        this.setStatus(r, 'done', { result: done.result ?? null, error: null, target }, undo);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The action failed';
      this.setStatus(r, 'failed', { result: null, error: message }, null);
      this.notify(r, `Action ${r.id} (${r.preview.summary}) failed: ${message}`);
      return this.card(r);
    }
    const result = r.outcome?.result ? ` ${r.outcome.result}` : '';
    this.notify(r, `Action ${r.id} done: ${r.preview.summary}.${result}`);
    return this.card(r);
  }

  /** `POST /api/actions/:id/cancel`. */
  cancel(user: User, id: string): ActionCard {
    const r = this.own(user.id, id);
    this.open(r);
    this.setStatus(r, 'cancelled', { result: null, error: null }, null);
    this.notify(r, `Action ${r.id} cancelled by the user: ${r.preview.summary}.`);
    return this.card(r);
  }

  /** Why `r` can't be undone by `a` now, or `null` when it can. */
  private undoBlocker(r: ActionRecord, a: Actor | null): string | null {
    const k = this.kinds[r.kind];
    if (!k.undo || r.status !== 'done' || !r.undo) return 'This action cannot be undone.';
    if (r.decidedAt === null || this.ctx.clock.now() > r.decidedAt + UNDO_WINDOW_MS)
      return 'Undo is only possible for 24 hours.';
    if (a) {
      const allowed =
        a.user.id === r.userId ||
        (a.perms.includes('audit.view') && (!k.permission || a.perms.includes(k.permission)));
      if (!allowed) return 'You cannot undo this action.';
    }
    if (this.targetChanged(r)) return 'It changed since, so it can no longer be undone.';
    return null;
  }

  private targetChanged(r: ActionRecord): boolean {
    const k = this.kinds[r.kind];
    if (!k.undo || !r.undo) return false;
    try {
      return hash(k.undo.state(r.undo.data)) !== r.undo.hash;
    } catch {
      return true;
    }
  }

  /** `POST /api/actions/:id/undo`: the proposer, or `audit.view` + the action's permission. */
  undo(user: User, id: string): ActionCard {
    const a = this.actor(user.id);
    const r = this.require(id);
    const k = this.kinds[r.kind];
    if (r.userId !== user.id && !a.perms.includes('audit.view'))
      throw new HttpError(404, 'not_found', `Action ${id} not found`);
    if (r.userId === user.id) this.requirePermission(a, k);
    const blocker = this.undoBlocker(r, a);
    if (blocker) throw new HttpError(409, 'not_undoable', blocker);
    const now = this.ctx.clock.now();
    try {
      atomic(this.ctx.db, () => {
        k.undo!.run(a, r.undo!.data);
        const { before, after } = rowsToMaps(r.preview.rows);
        this.audit.append({
          actorId: user.id,
          action: `${r.kind}.undo`,
          area: k.area,
          target: r.outcome?.target ?? r.preview.target,
          summary: `Undo: ${r.preview.summary}`,
          actionId: r.id,
          threadId: r.userId === user.id ? r.threadId : null,
          dashboardId: r.dashboardId,
          before: after,
          after: before,
        });
        this.audit.markUndone(r.id);
        this.stmt.undone.run(now, r.id);
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) throw err;
      const message = err instanceof Error ? err.message : 'Undo failed';
      throw new HttpError(409, 'not_undoable', message);
    }
    r.status = 'undone';
    r.undoneAt = now;
    this.notify(r, `Action ${r.id} was undone: ${r.preview.summary}.`);
    return this.card(r);
  }

  /** The chat card of a record (its status refreshed: an old proposal shows Expired). */
  card(r: ActionRecord): ActionCard {
    const now = this.ctx.clock.now();
    const status: ActionStatus =
      r.status === 'proposed' && r.expiresAt <= now ? 'expired' : r.status;
    const undoUntil =
      this.kinds[r.kind].undo && r.decidedAt !== null && r.status === 'done'
        ? r.decidedAt + UNDO_WINDOW_MS
        : null;
    return {
      id: r.id,
      kind: r.kind,
      area: this.kinds[r.kind].area,
      summary: r.preview.summary,
      target: r.outcome?.target ?? r.preview.target,
      rows: r.preview.rows.slice(0, ACTION_CARD_ROWS),
      more: Math.max(0, r.preview.rows.length - ACTION_CARD_ROWS),
      undoable: r.preview.undoable,
      status,
      error: status === 'expired' ? 'Expired. Ask again.' : (r.outcome?.error ?? null),
      result: r.outcome?.result ?? null,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      decidedAt: r.decidedAt,
      undoUntil,
      canUndo: undoUntil !== null && this.undoBlocker(r, null) === null,
    };
  }

  /** The proposer's card by id (thread reloads refresh the status), or `undefined`. */
  cardFor(userId: string, id: string): ActionCard | undefined {
    const r = this.get(id);
    return r && r.userId === userId ? this.card(r) : undefined;
  }

  // ---- audit (Activity page) ----

  /** `GET /api/audit` (caller holds `audit.view`). */
  auditPage(viewer: User, q: AuditQuery, limit = AUDIT_PAGE_SIZE): AuditPage {
    const rows = this.audit.query(q, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const a = this.actor(viewer.id);
    const users = this.audit
      .actorIds()
      .map((id) => ({ id, name: this.userName(id) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    return {
      items: page.map((row) => this.entry(row, a)),
      nextCursor: more ? String(page.at(-1)!.seq) : null,
      users,
    };
  }

  /** Every matching entry (CSV, capped). */
  auditAll(viewer: User, q: AuditQuery, cap = 10_000): AuditEntry[] {
    const a = this.actor(viewer.id);
    return this.audit.query({ ...q, before: undefined }, cap).map((row) => this.entry(row, a));
  }

  private userName(id: string): string {
    return this.ctx.accounts.users.get(id)?.name ?? id;
  }

  private entry(row: AuditRow, viewer: Actor): AuditEntry {
    const action = row.actionId ? this.get(row.actionId) : undefined;
    const isUndo = row.action.endsWith('.undo');
    const details = row.details as Partial<ActionAuditDetails> & Record<string, unknown>;
    const isAction = !!row.actionId;
    const changes: ActionRow[] = isAction
      ? [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])].map((label) => ({
          label,
          before: row.before[label] ?? null,
          after: row.after[label] ?? null,
        }))
      : Object.entries(details).map(([label, v]) => ({
          label,
          before: null,
          after: typeof v === 'string' ? v : JSON.stringify(v),
        }));
    const blocker = action && !isUndo ? this.undoBlocker(action, viewer) : 'n/a';
    return {
      id: row.seq,
      at: row.at,
      actorId: row.actorId,
      actorName: this.userName(row.actorId),
      kind: row.action,
      area: row.area,
      summary: details.summary ?? legacySummary(row),
      target: details.target ?? null,
      changes,
      status: !isAction ? 'logged' : isUndo ? 'undo' : row.undoneAt !== null ? 'undone' : 'done',
      actionId: row.actionId,
      threadId: row.actorId === viewer.user.id ? row.threadId : null,
      dashboardId: row.actorId === viewer.user.id ? (details.dashboardId ?? null) : null,
      undoable: blocker === null,
      targetChanged: !!action && !isUndo && action.status === 'done' && this.targetChanged(action),
    };
  }
}

const stale = () =>
  new HttpError(409, 'action_stale', 'This changed since it was proposed. Ask again to review it.');

const LEGACY: Record<string, string> = {
  'ai_key.saved': 'Saved an AI key',
  'ai_key.removed': 'Removed an AI key',
  'ai_settings.updated': 'Updated the AI settings',
};
const legacySummary = (row: AuditRow) => LEGACY[row.action] ?? row.action;

// ---- the action kinds (spec §2) ----

function buildKinds(ctx: MockContext): Record<ActionKind, AnyKind> {
  const { tree, sim, drivers, accounts, requests, shares, hub, notifications } = ctx;

  // -- lookups: by id or by name / regno / email; out of scope = the route's 403 / 404 --
  const fleetLabel = (n: FleetNode) => n.name;
  const fleet = (a: Actor, r: string, scoped = true): FleetNode => {
    const q = r.trim().toLowerCase();
    let node = tree.get(r.trim());
    if (!node) {
      const named = tree.nodes.filter(
        (n): n is FleetNode =>
          !!n && n.name.toLowerCase() === q && (!scoped || tree.inScope(n.id, a.scope)),
      );
      if (named.length > 1)
        throw new HttpError(
          422,
          'validation_failed',
          `More than one fleet is called "${r}"; use its id.`,
        );
      node = named[0];
    }
    if (!node) throw new HttpError(404, 'not_found', `Fleet ${r} not found`);
    return scoped ? requireFleetInScope(ctx, node.id, a.scope) : node;
  };
  const vehicle = (a: Actor, r: string): number => {
    let i = sim.indexOf(r.trim());
    if (i < 0) i = vehicleByRegno(sim, r);
    if (i < 0) throw new HttpError(404, 'not_found', `Vehicle ${r} not found`);
    return requireVehicleInScope(ctx, sim.vehicleId(i), a.scope);
  };
  const driver = (a: Actor, r: string): number => {
    let d = drivers.indexOf(r.trim());
    if (d < 0) {
      const q = r.trim().toLowerCase();
      const found: number[] = [];
      for (let k = 0; k < drivers.count && found.length < 2; k++)
        if (drivers.name(k).toLowerCase() === q && tree.inScope(drivers.fleetId(k), a.scope))
          found.push(k);
      if (found.length > 1)
        throw new HttpError(
          422,
          'validation_failed',
          `More than one driver is called "${r}"; use the driver id.`,
        );
      d = found[0] ?? -1;
    }
    if (d < 0) throw new HttpError(404, 'not_found', `Driver ${r} not found`);
    return requireDriverInScope(ctx, drivers.get(d).id, a.scope);
  };
  const userRec = (r: string) => {
    const u = accounts.users.get(r.trim()) ?? accounts.userByEmail(r);
    if (!u) throw new HttpError(404, 'not_found', `User ${r} not found`);
    return u;
  };
  const role = (r: string) => {
    const q = r.trim().toLowerCase();
    const found =
      accounts.roles.get(r.trim()) ??
      [...accounts.roles.values()].find((x) => x.name.toLowerCase() === q);
    if (!found) throw new HttpError(404, 'not_found', `Role ${r} not found`);
    return found;
  };
  const invite = (r: string) => {
    const q = r.trim().toLowerCase();
    const found =
      accounts.invites.get(r.trim()) ??
      [...accounts.invites.values()]
        .reverse()
        .find((i) => i.email === q && accounts.inviteStatus(i) === 'pending');
    if (!found) throw new HttpError(404, 'not_found', `Invite ${r} not found`);
    return found;
  };
  const fleetNames = (ids: readonly string[]) =>
    ids.map((id) => tree.get(id)?.name ?? id).join(', ');
  const roleName = (id: string) => accounts.roles.get(id)?.name ?? id;
  const regno = (i: number) => sim.regno(i);
  const vehicleTarget = (i: number): ActionTarget => ({
    type: 'vehicle',
    id: sim.vehicleId(i),
    label: regno(i),
  });
  const driverTarget = (d: number): ActionTarget => ({
    type: 'driver',
    id: drivers.get(d).id,
    label: drivers.name(d),
  });
  const fleetTarget = (n: FleetNode): ActionTarget => ({ type: 'fleet', id: n.id, label: n.name });
  const userTarget = (u: User): ActionTarget => ({ type: 'user', id: u.id, label: u.name });
  const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
  const noChange = () => new HttpError(422, 'validation_failed', 'Nothing would change.');
  const rejectSystemOnly = (permissions: readonly string[] | undefined) => {
    const blocked = SYSTEM_ONLY_PERMISSIONS.filter((p) => permissions?.includes(p));
    if (blocked.length)
      throw new HttpError(
        422,
        'validation_failed',
        `${blocked.join(', ')} can only be granted to system roles`,
      );
  };
  const permList = (ps: readonly Permission[]) =>
    ps.length ? ps.map((p) => PERMISSION_LABELS[p]).join(', ') : NONE;

  // -- drivers --
  const driverFields = (d: number) => {
    const g = drivers.get(d);
    return { name: g.name, phone: g.phone, fleetId: g.fleetId, status: g.status };
  };
  type DriverFields = ReturnType<typeof driverFields>;
  type DriverUndo = { driverId: string; prev: Partial<DriverFields>; keys: (keyof DriverFields)[] };
  type UserPatch = Partial<{
    name: string;
    roleId: string;
    fleetIds: string[];
    status: User['status'];
  }>;
  type UserUndo = { userId: string; prev: UserPatch; keys: string[] };
  const applyUser = (id: string, patch: UserPatch) => {
    if (patch.name !== undefined) accounts.rename(id, patch.name);
    const rest = { roleId: patch.roleId, fleetIds: patch.fleetIds, status: patch.status };
    if (Object.values(rest).some((v) => v !== undefined)) accounts.updateUser(id, rest);
  };
  const applyDriver = (d: number, f: Partial<DriverFields>) =>
    drivers.update(d, {
      ...(f.name === undefined ? {} : { name: f.name }),
      ...(f.phone === undefined ? {} : { phone: f.phone }),
      ...(f.status === undefined ? {} : { status: f.status }),
      ...(f.fleetId === undefined ? {} : { fleetIdx: tree.require(f.fleetId).idx }),
    });

  const assignment = (d: number) => {
    const i = drivers.vehicleOf(d);
    return i < 0 ? null : sim.vehicleId(i);
  };
  const reassign = (a: Actor, driverId: string, vehicleId: string | null) => {
    const d = requireDriverInScope(ctx, driverId, a.scope);
    if (vehicleId === null) drivers.unassign(d);
    else drivers.assign(d, requireVehicleInScope(ctx, vehicleId, a.scope), a.user.id);
  };
  type AssignUndo = { driverId: string; vehicleId: string | null; prevVehicleId: string | null };
  const assignUndo = {
    state: (u: AssignUndo) => ({
      now: assignment(drivers.require(u.driverId)),
      prevFree: u.prevVehicleId === null || drivers.driverOf(sim.indexOf(u.prevVehicleId)) < 0,
    }),
    run: (a: Actor, u: AssignUndo) => reassign(a, u.driverId, u.prevVehicleId),
  };

  const vehiclesFleets = (ids: readonly string[]) => ids.map((id) => sim.fleetId(sim.indexOf(id)));
  /** `POST /fleets/:id/vehicles` (one transaction; `moveTo` persists each move). */
  const moveVehicles = (indices: readonly number[], target: FleetNode) =>
    atomic(ctx.db, () => {
      for (const i of indices) {
        if (sim.fleet[i] === target.idx) continue;
        hub.vehicleMoved(i, sim.fleet[i]!);
        sim.moveTo(i, target.idx);
      }
    });

  const kinds: Record<ActionKind, AnyKind> = {
    'driver.create': def({
      area: 'drivers',
      permission: 'drivers.manage',
      schema: z.object({
        name: ref,
        phone: z.string().regex(PHONE_PATTERN, 'Phone must look like +91 9xxxx xxxxx'),
        fleet: ref,
        status: z.enum(DRIVER_STATUSES).default('active'),
      }),
      plan: (a, p) => {
        const f = fleet(a, p.fleet);
        return {
          target: fleetTarget(f),
          summary: `Add driver ${p.name} to ${fleetLabel(f)}`,
          rows: [
            { label: 'Name', before: null, after: p.name },
            { label: 'Phone', before: null, after: p.phone },
            { label: 'Fleet', before: null, after: fleetLabel(f) },
            { label: 'Status', before: null, after: p.status },
          ],
          state: { fleet: f.id },
          run: () => {
            const d = drivers.create({
              name: p.name,
              phone: p.phone,
              fleetIdx: f.idx,
              status: p.status,
            });
            return { target: driverTarget(d), result: `Driver id ${drivers.get(d).id}.` };
          },
        };
      },
    }),

    'driver.update': def({
      area: 'drivers',
      permission: 'drivers.manage',
      schema: z.object({
        driver: ref,
        name: ref.optional(),
        phone: z.string().regex(PHONE_PATTERN, 'Phone must look like +91 9xxxx xxxxx').optional(),
        fleet: ref.optional(),
        status: z.enum(DRIVER_STATUSES).optional(),
      }),
      plan: (a, p) => {
        const d = driver(a, p.driver);
        const before = driverFields(d);
        const next: Partial<DriverFields> = {};
        if (p.name !== undefined && p.name !== before.name) next.name = p.name;
        if (p.phone !== undefined && p.phone !== before.phone) next.phone = p.phone;
        if (p.status !== undefined && p.status !== before.status) next.status = p.status;
        if (p.fleet !== undefined) {
          const f = fleet(a, p.fleet);
          if (f.id !== before.fleetId) next.fleetId = f.id;
        }
        const keys = Object.keys(next) as (keyof DriverFields)[];
        if (!keys.length) throw noChange();
        const show = (k: keyof DriverFields, v: string) => (k === 'fleetId' ? fleetNames([v]) : v);
        const LABEL = { name: 'Name', phone: 'Phone', fleetId: 'Fleet', status: 'Status' };
        const prev = Object.fromEntries(keys.map((k) => [k, before[k]])) as Partial<DriverFields>;
        return {
          target: driverTarget(d),
          summary: `Update driver ${before.name}`,
          rows: keys.map((k) => ({
            label: LABEL[k],
            before: show(k, before[k]),
            after: show(k, next[k]!),
          })),
          state: before,
          run: () => {
            applyDriver(d, next);
            return { undo: { driverId: drivers.get(d).id, prev, keys } };
          },
        };
      },
      undo: {
        state: (u: DriverUndo) => {
          const f = driverFields(drivers.require(u.driverId));
          return u.keys.map((k) => f[k]);
        },
        run: (a, u: DriverUndo) =>
          applyDriver(requireDriverInScope(ctx, u.driverId, a.scope), u.prev),
      },
    }),

    'driver.assign': def({
      area: 'drivers',
      permission: 'drivers.manage',
      schema: z.object({ driver: ref, vehicle: ref }),
      plan: (a, p) => {
        const d = driver(a, p.driver);
        const i = vehicle(a, p.vehicle);
        const other = drivers.driverOf(i);
        if (other === d) throw conflict(`${drivers.name(d)} already drives ${regno(i)}.`);
        if (other >= 0)
          throw conflict(`${regno(i)} already has a driver (${drivers.name(other)}).`);
        if (drivers.status(d) === 'disabled') throw conflict('Driver is disabled');
        const cur = drivers.vehicleOf(d);
        return {
          target: driverTarget(d),
          summary: `Assign ${drivers.name(d)} to ${regno(i)}`,
          rows: [
            {
              label: `${drivers.name(d)}: vehicle`,
              before: cur < 0 ? NONE : regno(cur),
              after: regno(i),
            },
            { label: `${regno(i)}: driver`, before: NONE, after: drivers.name(d) },
          ],
          state: { cur: assignment(d), other, status: drivers.status(d) },
          run: () => {
            const driverId = drivers.get(d).id;
            const prevVehicleId = assignment(d);
            drivers.assign(d, i, a.user.id);
            return { undo: { driverId, vehicleId: sim.vehicleId(i), prevVehicleId } };
          },
        };
      },
      undo: assignUndo,
    }),

    'driver.unassign': def({
      area: 'drivers',
      permission: 'drivers.manage',
      schema: z.object({ driver: ref }),
      plan: (a, p) => {
        const d = driver(a, p.driver);
        const cur = drivers.vehicleOf(d);
        if (cur < 0) throw conflict(`${drivers.name(d)} has no vehicle.`);
        return {
          target: driverTarget(d),
          summary: `Unassign ${drivers.name(d)} from ${regno(cur)}`,
          rows: [{ label: `${drivers.name(d)}: vehicle`, before: regno(cur), after: NONE }],
          state: { cur: assignment(d) },
          run: () => {
            drivers.unassign(d);
            return {
              undo: {
                driverId: drivers.get(d).id,
                vehicleId: null,
                prevVehicleId: sim.vehicleId(cur),
              },
            };
          },
        };
      },
      undo: assignUndo,
    }),

    // -- requests (not undoable) --
    'request.approve': requestDef('approve'),
    'request.reject': requestDef('reject'),

    // -- users, invites, roles --
    'invite.create': def({
      area: 'users',
      permission: 'users.invite',
      schema: z.object({ email: z.email(), role: ref, fleets: z.array(ref).min(1).max(20) }),
      plan: (a, p) => {
        const r = role(p.role);
        const fleets = p.fleets.map((f) => fleet(a, f));
        const email = p.email.trim().toLowerCase();
        if (accounts.userByEmail(email)) throw conflict('A user with this email already exists');
        const pending = [...accounts.invites.values()].some(
          (i) => i.email === email && accounts.inviteStatus(i) === 'pending',
        );
        if (pending) throw conflict('A pending invite already exists for this email');
        return {
          target: { type: 'invite', id: email, label: email },
          summary: `Invite ${email} as ${r.name}`,
          rows: [
            { label: 'Email', before: null, after: email },
            { label: 'Role', before: null, after: r.name },
            { label: 'Fleets', before: null, after: fleets.map(fleetLabel).join(', ') },
          ],
          state: { email, roles: r.id, fleets: fleets.map((f) => f.id) },
          run: () => {
            const inv = accounts.invite(
              { email, roleId: r.id, fleetIds: fleets.map((f) => f.id) },
              a.user.id,
            );
            return {
              target: { type: 'invite', id: inv.id, label: email },
              undo: { inviteId: inv.id },
            };
          },
        };
      },
      undo: {
        state: (u: { inviteId: string }) =>
          accounts.inviteStatus(accounts.inviteRecord(u.inviteId)),
        run: (_a, u: { inviteId: string }) => accounts.revoke(u.inviteId),
      },
    }),

    'invite.resend': def({
      area: 'users',
      permission: 'users.invite',
      schema: z.object({ invite: ref }),
      plan: (_a, p) => {
        const inv = invite(p.invite);
        if (inv.status !== 'pending') throw conflict(`Invite is ${inv.status}`);
        return {
          target: { type: 'invite', id: inv.id, label: inv.email },
          summary: `Resend the invite to ${inv.email}`,
          rows: [{ label: 'Expires', before: 'Earlier link', after: 'New link, 7 days' }],
          state: { status: inv.status },
          run: () => {
            accounts.resend(inv.id);
            return {};
          },
        };
      },
    }),

    'invite.revoke': def({
      area: 'users',
      permission: 'users.invite',
      schema: z.object({ invite: ref }),
      plan: (_a, p) => {
        const inv = invite(p.invite);
        if (inv.status === 'accepted') throw conflict('Invite was already accepted');
        if (inv.status === 'revoked') throw conflict('Invite is already revoked');
        return {
          target: { type: 'invite', id: inv.id, label: inv.email },
          summary: `Revoke the invite to ${inv.email}`,
          rows: [{ label: 'Status', before: accounts.inviteStatus(inv), after: 'revoked' }],
          state: { status: inv.status },
          run: () => {
            accounts.revoke(inv.id);
            return {};
          },
        };
      },
    }),

    'user.update': def({
      area: 'users',
      permission: 'users.manage',
      schema: z.object({
        user: ref,
        name: ref.optional(),
        role: ref.optional(),
        fleets: z.array(ref).min(1).max(20).optional(),
        enabled: z.boolean().optional(),
      }),
      plan: (a, p) => {
        const u = userRec(p.user);
        const status = p.enabled === undefined ? undefined : p.enabled ? 'active' : 'disabled';
        const roleId = p.role === undefined ? undefined : role(p.role).id;
        if (
          u.id === a.user.id &&
          ((roleId !== undefined && roleId !== u.roleId) ||
            (status !== undefined && status !== u.status))
        )
          throw conflict('You cannot change your own role or status');
        const fleetIds = p.fleets?.map((f) => fleet(a, f, false).id);
        const before = {
          name: u.name,
          roleId: u.roleId,
          fleetIds: [...u.fleetIds],
          status: u.status,
        };
        const next: Partial<typeof before> = {};
        if (p.name !== undefined && p.name !== u.name) next.name = p.name;
        if (roleId !== undefined && roleId !== u.roleId) next.roleId = roleId;
        if (fleetIds && fleetIds.join() !== u.fleetIds.join()) next.fleetIds = fleetIds;
        if (status !== undefined && status !== u.status) next.status = status;
        const keys = Object.keys(next) as (keyof typeof before)[];
        if (!keys.length) throw noChange();
        const show = (k: keyof typeof before, v: unknown) =>
          k === 'roleId'
            ? roleName(v as string)
            : k === 'fleetIds'
              ? fleetNames(v as string[])
              : (v as string);
        const LABEL = { name: 'Name', roleId: 'Role', fleetIds: 'Fleets', status: 'Status' };
        const prev = Object.fromEntries(keys.map((k) => [k, before[k]]));
        return {
          target: userTarget(u),
          summary: `Update user ${u.name}`,
          rows: keys.map((k) => ({
            label: LABEL[k],
            before: show(k, before[k]),
            after: show(k, next[k]),
          })),
          state: before,
          run: () => {
            applyUser(u.id, next);
            return { undo: { userId: u.id, prev, keys } };
          },
        };
      },
      undo: {
        state: (x: UserUndo) => {
          const u = accounts.user(x.userId);
          const cur: Record<string, unknown> = {
            name: u.name,
            roleId: u.roleId,
            fleetIds: u.fleetIds,
            status: u.status,
          };
          return x.keys.map((k) => cur[k]);
        },
        run: (a, x: UserUndo) => {
          if (
            x.userId === a.user.id &&
            (x.prev.roleId !== undefined || x.prev.status !== undefined)
          )
            throw conflict('You cannot change your own role or status');
          if (x.prev.roleId !== undefined) role(x.prev.roleId);
          applyUser(x.userId, x.prev);
        },
      },
    }),

    'role.create': def({
      area: 'roles',
      permission: 'roles.manage',
      schema: z.object({ name: ref, permissions: z.array(permissionSchema) }),
      plan: (_a, p) => {
        rejectSystemOnly(p.permissions);
        return {
          target: { type: 'role', id: p.name, label: p.name },
          summary: `Create role ${p.name}`,
          rows: [
            { label: 'Name', before: null, after: p.name },
            { label: 'Permissions', before: null, after: permList(p.permissions) },
          ],
          state: null,
          run: () => {
            const r = accounts.addRole({
              id: `role-${randomUUID()}`,
              system: false,
              name: p.name,
              permissions: [...new Set(p.permissions)],
            });
            return { target: { type: 'role', id: r.id, label: r.name } };
          },
        };
      },
    }),

    'role.update': def({
      area: 'roles',
      permission: 'roles.manage',
      schema: z.object({
        role: ref,
        name: ref.optional(),
        permissions: z.array(permissionSchema).optional(),
      }),
      plan: (_a, p) => {
        const r = role(p.role);
        if (r.system) throw conflict('System roles cannot be edited');
        rejectSystemOnly(p.permissions);
        const before = { name: r.name, permissions: [...r.permissions] };
        const rows: ActionRow[] = [];
        const next: { name?: string; permissions?: Permission[] } = {};
        if (p.name !== undefined && p.name !== r.name) {
          next.name = p.name;
          rows.push({ label: 'Name', before: r.name, after: p.name });
        }
        if (
          p.permissions &&
          [...new Set(p.permissions)].sort().join() !== [...r.permissions].sort().join()
        ) {
          next.permissions = [...new Set(p.permissions)];
          const added = next.permissions.filter((x) => !r.permissions.includes(x));
          const removed = r.permissions.filter((x) => !next.permissions!.includes(x));
          for (const x of added)
            rows.push({ label: PERMISSION_LABELS[x], before: 'Off', after: 'On' });
          for (const x of removed)
            rows.push({ label: PERMISSION_LABELS[x], before: 'On', after: 'Off' });
        }
        if (!rows.length) throw noChange();
        return {
          target: { type: 'role', id: r.id, label: r.name },
          summary: `Update role ${r.name}`,
          rows,
          state: before,
          run: () => {
            accounts.updateRole(r.id, next);
            return { undo: { roleId: r.id, prev: before } };
          },
        };
      },
      undo: {
        state: (u: { roleId: string }) => {
          const r = accounts.role(u.roleId);
          return { name: r.name, permissions: r.permissions };
        },
        run: (_a, u: { roleId: string; prev: { name: string; permissions: Permission[] } }) => {
          accounts.updateRole(u.roleId, u.prev);
        },
      },
    }),

    'role.delete': def({
      area: 'roles',
      permission: 'roles.manage',
      schema: z.object({ role: ref }),
      plan: (_a, p) => {
        const r = role(p.role);
        if (r.system) throw conflict('System roles cannot be deleted');
        return {
          target: { type: 'role', id: r.id, label: r.name },
          summary: `Delete role ${r.name}`,
          rows: [{ label: 'Role', before: r.name, after: null }],
          state: { name: r.name, permissions: r.permissions },
          run: () => {
            accounts.deleteRole(r.id);
            return {};
          },
        };
      },
    }),

    // -- fleets --
    'fleet.create': def({
      area: 'fleets',
      permission: 'fleets.manage',
      schema: z.object({ parent: ref, name: ref }),
      plan: (a, p) => {
        const parent = fleet(a, p.parent);
        return {
          target: fleetTarget(parent),
          summary: `Create fleet ${p.name} under ${parent.name}`,
          rows: [
            { label: 'Name', before: null, after: p.name },
            { label: 'Parent', before: null, after: parent.name },
          ],
          state: { parent: parent.id },
          run: () => ({ target: fleetTarget(tree.create(parent.id, p.name)) }),
        };
      },
    }),

    'fleet.rename': def({
      area: 'fleets',
      permission: 'fleets.manage',
      schema: z.object({ fleet: ref, name: ref }),
      plan: (a, p) => {
        const f = fleet(a, p.fleet);
        if (f.name === p.name) throw noChange();
        const from = f.name;
        return {
          target: fleetTarget(f),
          summary: `Rename fleet ${from} to ${p.name}`,
          rows: [{ label: 'Name', before: from, after: p.name }],
          state: { name: from },
          run: () => {
            tree.update(f.id, { name: p.name });
            return { target: fleetTarget(f), undo: { fleetId: f.id, name: from } };
          },
        };
      },
      undo: {
        state: (u: { fleetId: string }) => tree.require(u.fleetId).name,
        run: (a, u: { fleetId: string; name: string }) => {
          requireFleetInScope(ctx, u.fleetId, a.scope);
          tree.update(u.fleetId, { name: u.name });
        },
      },
    }),

    'fleet.delete': def({
      area: 'fleets',
      permission: 'fleets.manage',
      schema: z.object({ fleet: ref }),
      plan: (a, p) => {
        const f = fleet(a, p.fleet);
        if (f.parent < 0) throw conflict('The root fleet cannot be deleted');
        const dto = tree.list([f.id]);
        if (dto.length > 1) throw conflict('Fleet still has child fleets');
        if ((dto[0]?.vehicleCount ?? 0) > 0) throw conflict('Fleet still has vehicles');
        return {
          target: fleetTarget(f),
          summary: `Delete fleet ${f.name}`,
          rows: [{ label: 'Fleet', before: f.name, after: null }],
          state: { name: f.name, parent: f.parent },
          run: () => {
            tree.remove(f.id);
            return {};
          },
        };
      },
    }),

    'fleet.settings': def({
      area: 'fleets',
      permission: 'fleets.manage',
      schema: z.object({ fleet: ref, autoAssignReplacement: z.boolean().nullable() }),
      plan: (a, p) => {
        const f = fleet(a, p.fleet);
        const before = requests.settings(f.idx);
        const show = (v: boolean | null, inherited: boolean) =>
          v === null ? `Inherit (${yesNo(inherited)})` : yesNo(v);
        const prev = before.overridden ? before.autoAssignReplacement : null;
        if (prev === p.autoAssignReplacement) throw noChange();
        return {
          target: fleetTarget(f),
          summary: `Set auto-assign replacement for ${f.name} to ${show(p.autoAssignReplacement, before.autoAssignReplacement)}`,
          rows: [
            {
              label: 'Auto-assign replacement',
              before: show(prev, before.autoAssignReplacement),
              after: p.autoAssignReplacement === null ? 'Inherit' : yesNo(p.autoAssignReplacement),
            },
          ],
          state: before,
          run: () => {
            requests.setAutoAssign(f.idx, p.autoAssignReplacement);
            return { undo: { fleetId: f.id, prev } };
          },
        };
      },
      undo: {
        state: (u: { fleetId: string }) => requests.settings(tree.require(u.fleetId).idx),
        run: (a, u: { fleetId: string; prev: boolean | null }) =>
          requests.setAutoAssign(requireFleetInScope(ctx, u.fleetId, a.scope).idx, u.prev),
      },
    }),

    'vehicles.move': def({
      area: 'fleets',
      permission: 'fleets.manage',
      schema: z.object({ vehicles: z.array(ref).min(1).max(ACTION_BATCH_MAX), fleet: ref }),
      plan: (a, p) => {
        const target = fleet(a, p.fleet);
        const indices = [...new Set(p.vehicles.map((v) => vehicle(a, v)))];
        const moving = indices.filter((i) => sim.fleet[i] !== target.idx);
        if (!moving.length) throw noChange();
        const ids = moving.map((i) => sim.vehicleId(i));
        return {
          target: fleetTarget(target),
          summary:
            moving.length === 1
              ? `Move ${regno(moving[0]!)} to ${target.name}`
              : `Move ${moving.length} vehicles to ${target.name}`,
          rows: moving.map((i) => ({
            label: regno(i),
            before: tree.node(sim.fleet[i]!).name,
            after: target.name,
          })),
          state: vehiclesFleets(ids),
          run: () => {
            const moves = ids.map((vehicleId) => ({
              vehicleId,
              from: sim.fleetId(sim.indexOf(vehicleId)),
            }));
            moveVehicles(moving, target);
            return { undo: { moves } };
          },
        };
      },
      undo: {
        state: (u: { moves: { vehicleId: string }[] }) =>
          vehiclesFleets(u.moves.map((m) => m.vehicleId)),
        run: (a, u: { moves: { vehicleId: string; from: string }[] }) => {
          const byFleet = new Map<string, number[]>();
          for (const m of u.moves) {
            const i = requireVehicleInScope(ctx, m.vehicleId, a.scope);
            requireFleetInScope(ctx, m.from, a.scope);
            byFleet.set(m.from, [...(byFleet.get(m.from) ?? []), i]);
          }
          for (const [fleetId, list] of byFleet) moveVehicles(list, tree.require(fleetId));
        },
      },
    }),

    // -- sharing & notifications --
    'share_link.create': def({
      area: 'sharing',
      permission: 'share.create',
      schema: z.object({
        vehicle: ref,
        expiresInHours: z
          .number()
          .min(0.25)
          .max(24 * 30)
          .default(24),
        trailMinutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .nullable()
          .default(null),
        showDrivingEnergy: z.boolean().default(false),
        showDevice: z.boolean().default(false),
      }),
      plan: (a, p) => {
        const i = vehicle(a, p.vehicle);
        return {
          target: vehicleTarget(i),
          summary: `Share the live location of ${regno(i)} for ${p.expiresInHours} h`,
          rows: [
            { label: 'Vehicle', before: null, after: regno(i) },
            { label: 'Expires in', before: null, after: `${p.expiresInHours} h` },
            {
              label: 'Trail',
              before: null,
              after: p.trailMinutes ? `${p.trailMinutes} min` : 'Off',
            },
            { label: 'Driving & energy', before: null, after: yesNo(p.showDrivingEnergy) },
            { label: 'Device', before: null, after: yesNo(p.showDevice) },
          ],
          state: { vehicle: sim.vehicleId(i) },
          run: () => {
            const link = shares.create(
              {
                vehicleId: sim.vehicleId(i),
                expiresAt: ctx.clock.now() + Math.round(p.expiresInHours * 3_600_000),
                show: { drivingEnergy: p.showDrivingEnergy, device: p.showDevice },
                trail: { enabled: p.trailMinutes !== null, windowMinutes: p.trailMinutes ?? 60 },
              },
              a.user.id,
            );
            return {
              target: { type: 'share_link', id: link.id, label: regno(i) },
              result: `Link: ${link.url}`,
              undo: { linkId: link.id },
            };
          },
        };
      },
      undo: {
        state: (u: { linkId: string }) => shares.get(u.linkId).revokedAt ?? null,
        run: (_a, u: { linkId: string }) => {
          shares.revoke(shares.get(u.linkId));
          hub.closeShare(u.linkId);
        },
      },
    }),

    'share_link.revoke': def({
      area: 'sharing',
      permission: null,
      schema: z.object({ link: ref }),
      plan: (a, p) => {
        const link = shares.get(p.link.trim());
        const i = sim.indexOf(link.vehicleId);
        const canRevoke =
          link.createdBy === a.user.id ||
          (a.perms.includes('share.revoke') && i >= 0 && tree.inScope(sim.fleetId(i), a.scope));
        if (!canRevoke) throw new HttpError(403, 'forbidden', 'You cannot revoke this share link');
        if (link.revokedAt !== undefined) throw conflict('This link is already revoked');
        const label = i >= 0 ? regno(i) : link.vehicleId;
        return {
          target: { type: 'share_link', id: link.id, label },
          summary: `Revoke the share link of ${label}`,
          rows: [
            {
              label: 'Status',
              before: shares.isLive(link) ? 'Active' : 'Expired',
              after: 'Revoked',
            },
          ],
          state: { revokedAt: link.revokedAt ?? null },
          run: () => {
            shares.revoke(link);
            hub.closeShare(link.id);
            return {};
          },
        };
      },
    }),

    'notifications.read': def({
      area: 'notifications',
      permission: null,
      schema: z
        .object({ ids: z.array(ref).min(1).max(200).optional(), all: z.boolean().optional() })
        .refine((x) => x.all === true || !!x.ids, { message: 'Give ids or all: true' }),
      plan: (a, p) => {
        const unread = notifications.list(a.user, a.perms, { limit: 1 }).unreadCount;
        const n = p.all ? unread : p.ids!.length;
        return {
          target: { type: 'notifications', id: a.user.id, label: 'Notifications' },
          summary: p.all
            ? 'Mark all notifications as read'
            : `Mark ${n} notification${n === 1 ? '' : 's'} as read`,
          rows: [
            {
              label: 'Unread',
              before: String(unread),
              after: p.all ? '0' : `${Math.max(0, unread - n)} or more`,
            },
          ],
          state: null,
          run: () => {
            const res = notifications.markRead(
              a.user,
              a.perms,
              p.all ? { all: true } : { ids: p.ids! },
            );
            return { result: `${res.unreadCount} unread left.` };
          },
        };
      },
    }),
  };
  return kinds;

  function requestDef(action: 'approve' | 'reject') {
    return def({
      area: 'requests',
      permission: 'requests.manage',
      schema: z.object({
        request: ref,
        note: z.string().trim().max(500).optional(),
        /** approve: the replacement vehicle (default: the suggested one). */
        vehicle: ref.optional(),
      }),
      plan: (a, p) => {
        const r = requests.get(p.request.trim());
        if (!tree.inScope(r.fleetId, a.scope))
          throw new HttpError(404, 'not_found', `Request ${p.request} not found`);
        if (r.type !== 'replacement')
          throw conflict(
            `Only replacement requests can be ${action === 'approve' ? 'approved' : 'rejected'}.`,
          );
        const allowed =
          action === 'approve'
            ? ['open', 'waiting', 'suggested']
            : ['open', 'waiting', 'suggested', 'approved'];
        if (!allowed.includes(r.status))
          throw conflict(`Cannot ${action} a request that is ${r.status}`);
        let vehicleId = r.replacement?.suggestedVehicleId;
        if (p.vehicle !== undefined) vehicleId = sim.vehicleId(vehicle(a, p.vehicle));
        if (action === 'approve' && !vehicleId)
          throw new HttpError(422, 'validation_failed', 'Approving needs a replacement vehicle');
        const verb =
          action === 'approve' &&
          (r.status !== 'suggested' || vehicleId !== r.replacement?.suggestedVehicleId)
            ? 'override'
            : action;
        const vi = vehicleId ? sim.indexOf(vehicleId) : -1;
        const label = `${regno(sim.indexOf(r.vehicleId))} (${r.type})`;
        return {
          target: { type: 'request', id: r.id, label },
          summary:
            action === 'approve'
              ? `Approve the replacement for ${label} with ${vi >= 0 ? regno(vi) : vehicleId}`
              : `Reject the request for ${label}`,
          rows: [
            {
              label: 'Status',
              before: r.status,
              after: action === 'approve' ? 'assigned' : 'rejected',
            },
            ...(action === 'approve' && vi >= 0
              ? [{ label: 'Replacement', before: NONE, after: regno(vi) }]
              : []),
          ],
          state: { status: r.status, updatedAt: r.updatedAt },
          run: () => {
            requests.act(
              r,
              {
                action: verb,
                ...(p.note ? { note: p.note } : {}),
                ...(action === 'approve' ? { vehicleId } : {}),
              },
              a.user.id,
              a.scope,
            );
            return {};
          },
        };
      },
    });
  }
}
