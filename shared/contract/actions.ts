import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * F29 (D-166…D-168): write actions the assistant proposes and the user confirms, the audit log
 * behind the Activity page, and Undo.
 */

export const ACTION_AREAS = [
  'drivers',
  'requests',
  'users',
  'roles',
  'fleets',
  'sharing',
  'notifications',
  /** F25 AI-key and AI-settings entries (written outside the assistant). */
  'settings',
] as const;
export const actionAreaSchema = z.enum(ACTION_AREAS);
export type ActionArea = z.infer<typeof actionAreaSchema>;

export const ACTION_KINDS = [
  'driver.create',
  'driver.update',
  'driver.assign',
  'driver.unassign',
  'request.approve',
  'request.reject',
  'invite.create',
  'invite.resend',
  'invite.revoke',
  'user.update',
  'role.create',
  'role.update',
  'role.delete',
  'fleet.create',
  'fleet.rename',
  'fleet.delete',
  'fleet.settings',
  'vehicles.move',
  'share_link.create',
  'share_link.revoke',
  'notifications.read',
] as const;
export const actionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const ACTION_STATUSES = [
  'proposed',
  'done',
  'failed',
  'cancelled',
  'expired',
  'undone',
] as const;
export const actionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

/** At most this many items in one batch (e.g. `vehicles.move`). */
export const ACTION_BATCH_MAX = 50;
/** A card shows at most this many before → after rows, then "+N more". */
export const ACTION_CARD_ROWS = 5;

export const ACTION_TARGET_TYPES = [
  'driver',
  'vehicle',
  'user',
  'invite',
  'role',
  'fleet',
  'request',
  'share_link',
  'notifications',
  'org',
] as const;
export const actionTargetSchema = z.object({
  type: z.enum(ACTION_TARGET_TYPES),
  id: z.string(),
  label: z.string(),
});
export type ActionTarget = z.infer<typeof actionTargetSchema>;

export const actionRowSchema = z.object({
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ActionRow = z.infer<typeof actionRowSchema>;

/** What the chat card (and `POST /api/actions/:id/*`) shows for one proposal. */
export const actionCardSchema = z.object({
  id: z.string(),
  kind: actionKindSchema,
  area: actionAreaSchema,
  summary: z.string(),
  target: actionTargetSchema,
  /** The first `ACTION_CARD_ROWS` rows. */
  rows: z.array(actionRowSchema).max(ACTION_CARD_ROWS),
  /** Rows not shown ("+N more"). */
  more: z.number().int().nonnegative(),
  /** The kind can be undone (the card says so before Confirm). */
  undoable: z.boolean(),
  status: actionStatusSchema,
  /** Why it failed or was refused. */
  error: z.string().nullable(),
  /** A short result line (e.g. a share link's URL). */
  result: z.string().nullable(),
  createdAt: epochMsSchema,
  expiresAt: epochMsSchema,
  decidedAt: epochMsSchema.nullable(),
  /** Undo is offered until then (done + reversible only). */
  undoUntil: epochMsSchema.nullable(),
  /** Undo is possible right now (in time, target unchanged). */
  canUndo: z.boolean(),
});
export type ActionCard = z.infer<typeof actionCardSchema>;

/** SSE chat event (both chats). */
export const actionProposedEventSchema = z.object({
  type: z.literal('action_proposed'),
  action: actionCardSchema,
});
export type ActionProposedEvent = z.infer<typeof actionProposedEventSchema>;

// ---- audit log / Activity page ----

export const auditStatusSchema = z.enum(['done', 'undone', 'undo', 'logged']);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

export const auditEntrySchema = z.object({
  id: z.number().int(),
  at: epochMsSchema,
  actorId: z.string(),
  actorName: z.string(),
  /** `driver.assign`, `driver.assign.undo`, `ai_key.saved`… */
  kind: z.string(),
  area: actionAreaSchema,
  summary: z.string(),
  target: actionTargetSchema.nullable(),
  /** Before → after, one row per changed field. */
  changes: z.array(actionRowSchema),
  /** `done`; `undone` (reverted later); `undo` (the revert itself); `logged` (F25 entries). */
  status: auditStatusSchema,
  actionId: z.string().nullable(),
  /** Only on the viewer's own entries (chats stay private, F28). */
  threadId: z.string().nullable(),
  dashboardId: z.string().nullable(),
  /** The viewer may undo it now. */
  undoable: z.boolean(),
  /** The target changed since (so it can no longer be undone). */
  targetChanged: z.boolean(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

const optionalMs = z.coerce.number().int().nonnegative().optional();
export const auditQuerySchema = z.object({
  user: z.string().optional(),
  area: actionAreaSchema.optional(),
  kind: z.string().optional(),
  from: optionalMs,
  to: optionalMs,
  q: z.string().trim().max(200).optional(),
  /** Cursor: entries with a smaller id. */
  before: optionalMs,
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
  /** Everyone who appears in the log (the user filter). */
  users: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_CSV_HEADER = [
  'time_ist',
  'user',
  'area',
  'action',
  'summary',
  'target',
  'status',
] as const;
