import type { ActionKind, ActionProposedEvent, ChatEvent } from '@shared/contract/index.ts';
import { z } from 'zod';
import { HttpError } from '../http-error.ts';
import { spec, ToolFailure, type ToolHost, type ToolOutput, type ToolSpec } from './tool-kit.ts';

/**
 * F29 (D-166) write tools. None of them changes data: each validates the input, checks the
 * user's permission and stores a proposal through `ctx.actions.propose` (the same store function,
 * scope rule and permission as the REST route run only on Confirm), emits `action_proposed` with
 * the card and tells the model that nothing has happened yet. No tool confirms.
 */

/** The thread the tool runs in (F28 sets it on the host; absent in older hosts and tests). */
type ActionHost = ToolHost & { threadId?: string | null };

const s = (what: string) => z.string().describe(what);
const DRIVER = 'Driver id or exact full name.';
const VEHICLE = 'Vehicle regno or vehicle id.';
const FLEET = 'Fleet name or id.';

function propose(host: ActionHost, kind: ActionKind, params: unknown): ToolOutput {
  let card;
  try {
    card = host.ctx.actions.propose(host.user, {
      kind,
      params,
      threadId: host.threadId ?? null,
      dashboardId: host.mode?.kind === 'dashboard' ? host.mode.dashboardId : null,
    });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    if (err.status === 403)
      throw new ToolFailure(`Not permitted: ${err.message}.`, 'not_permitted');
    if (err.status === 404) throw new ToolFailure(err.message, 'not_found');
    throw new ToolFailure(err.message);
  }
  const event: ActionProposedEvent = { type: 'action_proposed', action: card };
  // `action_proposed` joins the chat event union when the chats render action cards.
  host.emit(event as unknown as ChatEvent);
  return {
    result: {
      actionId: card.id,
      status: 'proposed',
      summary: card.summary,
      changes: card.rows,
      moreChanges: card.more,
      undoable: card.undoable,
      note: `Proposed ${card.summary} (action ${card.id}). Nothing has changed yet; the user must confirm it in the chat. Do not say it is done.`,
    },
    summary: `Proposed: ${card.summary}`,
  };
}

const tool = <S extends z.ZodType>(
  name: string,
  kind: ActionKind,
  description: string,
  schema: S,
  label: (i: z.infer<S>) => string,
): ToolSpec<S> =>
  spec({
    name,
    description: `${description} Proposes the change for the user to confirm; nothing changes until they press Confirm in the chat.`,
    schema,
    label,
    run: async (host, input) => propose(host, kind, input),
  });

const DRIVER_STATUS = z.enum(['active', 'off-duty', 'disabled']);

const ACTION_SPECS_UNSORTED = [
  tool(
    'propose_driver_create',
    'driver.create',
    'Add a new driver (drivers.manage).',
    z.object({
      name: s('Full name.'),
      phone: s('Phone, formatted +91 9xxxx xxxxx.'),
      fleet: s(FLEET),
      status: DRIVER_STATUS.optional(),
    }),
    (i) => `Proposing new driver ${i.name}…`,
  ),
  tool(
    'propose_driver_update',
    'driver.update',
    "Edit a driver's name, phone, fleet or status (drivers.manage). Undoable.",
    z.object({
      driver: s(DRIVER),
      name: s('New name.').optional(),
      phone: s('New phone, +91 9xxxx xxxxx.').optional(),
      fleet: s(`New ${FLEET}`).optional(),
      status: DRIVER_STATUS.optional(),
    }),
    (i) => `Proposing changes to ${i.driver}…`,
  ),
  tool(
    'propose_driver_assign',
    'driver.assign',
    'Assign a driver to a vehicle that has no driver (drivers.manage). Undoable.',
    z.object({ driver: s(DRIVER), vehicle: s(VEHICLE) }),
    (i) => `Proposing ${i.driver} → ${i.vehicle}…`,
  ),
  tool(
    'propose_driver_unassign',
    'driver.unassign',
    'Take a driver off their current vehicle (drivers.manage). Undoable.',
    z.object({ driver: s(DRIVER) }),
    (i) => `Proposing to unassign ${i.driver}…`,
  ),
  tool(
    'propose_request_approve',
    'request.approve',
    'Approve a replacement request with its suggested vehicle or another free one (requests.manage). Not undoable.',
    z.object({
      request: s('Request id.'),
      vehicle: s(`Replacement ${VEHICLE} Default: the suggested one.`).optional(),
      note: s('Optional note.').optional(),
    }),
    (i) => `Proposing to approve ${i.request}…`,
  ),
  tool(
    'propose_request_reject',
    'request.reject',
    'Reject a replacement request (requests.manage). Not undoable.',
    z.object({ request: s('Request id.'), note: s('Optional reason.').optional() }),
    (i) => `Proposing to reject ${i.request}…`,
  ),
  tool(
    'propose_invite_create',
    'invite.create',
    'Invite a new user by email with a role and fleets (users.invite). Undo revokes the invite.',
    z.object({
      email: s('Email address.'),
      role: s('Role name or id.'),
      fleets: z.array(z.string()).describe('Fleet names or ids the user may see.'),
    }),
    (i) => `Proposing an invite for ${i.email}…`,
  ),
  tool(
    'propose_invite_resend',
    'invite.resend',
    'Resend a pending invite (new link, 7 days) (users.invite).',
    z.object({ invite: s('Invite id or the invited email.') }),
    (i) => `Proposing to resend ${i.invite}…`,
  ),
  tool(
    'propose_invite_revoke',
    'invite.revoke',
    'Revoke a pending invite (users.invite). Not undoable.',
    z.object({ invite: s('Invite id or the invited email.') }),
    (i) => `Proposing to revoke ${i.invite}…`,
  ),
  tool(
    'propose_user_update',
    'user.update',
    "Edit a user's name, role, fleets, or enable / disable them (users.manage). Undoable. Users can't be deleted.",
    z.object({
      user: s('User id or email.'),
      name: s('New name.').optional(),
      role: s('New role name or id.').optional(),
      fleets: z
        .array(z.string())
        .describe('New fleet names or ids (replaces the list).')
        .optional(),
      enabled: z.boolean().describe('false disables the user (ends their sessions).').optional(),
    }),
    (i) => `Proposing changes to ${i.user}…`,
  ),
  tool(
    'propose_role_create',
    'role.create',
    'Create a custom role with permission ids (roles.manage). Not undoable.',
    z.object({
      name: s('Role name.'),
      permissions: z.array(z.string()).describe('Permission ids, e.g. live.view, table.export.'),
    }),
    (i) => `Proposing role ${i.name}…`,
  ),
  tool(
    'propose_role_update',
    'role.update',
    'Rename a custom role or replace its permission ids (roles.manage). Undoable.',
    z.object({
      role: s('Role name or id.'),
      name: s('New name.').optional(),
      permissions: z.array(z.string()).describe('The full new permission id list.').optional(),
    }),
    (i) => `Proposing changes to role ${i.role}…`,
  ),
  tool(
    'propose_role_delete',
    'role.delete',
    'Delete a custom role nobody uses (roles.manage). Not undoable.',
    z.object({ role: s('Role name or id.') }),
    (i) => `Proposing to delete role ${i.role}…`,
  ),
  tool(
    'propose_fleet_create',
    'fleet.create',
    'Create a sub-fleet (fleets.manage). Not undoable.',
    z.object({ parent: s(`Parent ${FLEET}`), name: s('New fleet name.') }),
    (i) => `Proposing fleet ${i.name}…`,
  ),
  tool(
    'propose_fleet_rename',
    'fleet.rename',
    'Rename a fleet (fleets.manage). Undoable.',
    z.object({ fleet: s(FLEET), name: s('New name.') }),
    (i) => `Proposing to rename ${i.fleet}…`,
  ),
  tool(
    'propose_fleet_delete',
    'fleet.delete',
    'Delete an empty fleet with no sub-fleets (fleets.manage). Not undoable.',
    z.object({ fleet: s(FLEET) }),
    (i) => `Proposing to delete ${i.fleet}…`,
  ),
  tool(
    'propose_fleet_settings',
    'fleet.settings',
    "Set a fleet's auto-assign-replacement setting; null inherits from the parent (fleets.manage). Undoable.",
    z.object({
      fleet: s(FLEET),
      autoAssignReplacement: z.boolean().nullable().describe('true, false, or null to inherit.'),
    }),
    (i) => `Proposing settings for ${i.fleet}…`,
  ),
  tool(
    'propose_vehicles_move',
    'vehicles.move',
    'Move up to 50 vehicles to another fleet as one all-or-nothing batch (fleets.manage). Undoable.',
    z.object({
      vehicles: z.array(z.string()).describe('Vehicle regnos or ids (at most 50).'),
      fleet: s(`Target ${FLEET}`),
    }),
    (i) => `Proposing to move ${i.vehicles.length} vehicle(s) to ${i.fleet}…`,
  ),
  tool(
    'propose_share_link_create',
    'share_link.create',
    'Create a public live-location share link for a vehicle (share.create). Undo revokes it.',
    z.object({
      vehicle: s(VEHICLE),
      expiresInHours: z
        .number()
        .describe('Hours until it expires (default 24, max 720).')
        .optional(),
      trailMinutes: z
        .number()
        .int()
        .nullable()
        .describe('Show the last N minutes of trail; null or absent for no trail.')
        .optional(),
      showDrivingEnergy: z.boolean().describe('Show speed and battery / fuel.').optional(),
      showDevice: z.boolean().describe('Show device health.').optional(),
    }),
    (i) => `Proposing a share link for ${i.vehicle}…`,
  ),
  tool(
    'propose_share_link_revoke',
    'share_link.revoke',
    'Revoke a share link (its creator, or share.revoke). Not undoable.',
    z.object({ link: s('Share link id.') }),
    (i) => `Proposing to revoke ${i.link}…`,
  ),
  tool(
    'propose_notifications_read',
    'notifications.read',
    "Mark the user's notifications as read: given ids, or all. Not undoable.",
    z.object({
      ids: z.array(z.string()).describe('Notification ids.').optional(),
      all: z.boolean().describe('true marks every notification read.').optional(),
    }),
    () => 'Proposing to mark notifications read…',
  ),
];

/**
 * F29 write tools, sorted by name (a fixed order keeps the cached prompt prefix stable). Add
 * them to `SPECS` in `assistant-tools.ts` to offer them in both chats.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTION_SPECS: ToolSpec<any>[] = ACTION_SPECS_UNSORTED.sort((a, b) =>
  a.name.localeCompare(b.name),
);

export const ACTION_TOOL_NAMES = ACTION_SPECS.map((t) => t.name);
