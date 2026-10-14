import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  PERMISSIONS,
  type Invite,
  type Mail,
  type Me,
  type Permission,
  type Role,
  type User,
} from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import type { FleetTree } from '../generator/fleet-tree.ts';
import { HttpError } from '../http-error.ts';

export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const RESET_TTL_MS = 30 * 60_000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAILBOX_SIZE = 200;

interface UserRecord extends User {
  salt: string;
  hash: string;
}
interface InviteRecord extends Invite {
  token: string;
}
interface Session {
  userId: string;
  expiresAt: number;
}
interface ResetToken {
  userId: string;
  expiresAt: number;
  used: boolean;
}

export const token = () => randomBytes(32).toString('base64url');
const hashPassword = (password: string, salt: string) =>
  scryptSync(password, salt, 32, { N: 1024 }).toString('hex');
const normEmail = (email: string) => email.trim().toLowerCase();

export const SUPER_ADMIN_ROLE = 'role-super-admin';
export const DRIVER_ROLE = 'role-driver';
export const DRIVER_USER_ID = 'u-driver';

/** Users, roles, sessions, invites, reset tokens and the dev mailbox (memory only). */
export class Accounts {
  readonly roles = new Map<string, Role>();
  readonly users = new Map<string, UserRecord>();
  readonly invites = new Map<string, InviteRecord>();
  private readonly sessions = new Map<string, Session>();
  private readonly resets = new Map<string, ResetToken>();
  readonly mailbox: Mail[] = [];
  /** Called after an invite is accepted (links invited drivers to their new user). */
  readonly onInviteAccepted: ((inviteId: string, userId: string) => void)[] = [];

  constructor(
    private readonly clock: Clock,
    tree: FleetTree,
    private readonly onMail: (mail: Mail) => void = () => {},
  ) {
    this.addRole({
      id: SUPER_ADMIN_ROLE,
      name: 'Super Admin',
      permissions: [...PERMISSIONS],
      system: true,
    });
    this.addRole({
      id: 'role-operator',
      name: 'Operator',
      system: false,
      permissions: [
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
      ],
    });
    this.addRole({
      id: 'role-viewer',
      name: 'Viewer',
      system: false,
      permissions: ['live.view', 'vehicle.details.view'],
    });
    this.addRole({ id: DRIVER_ROLE, name: 'Driver', permissions: ['driver.self'], system: true });
    const fleetId = (name: string) => [...tree.byId.values()].find((f) => f.name === name)!.id;
    this.addUser(
      'superadmin@fms.local',
      'Super Admin',
      'Admin@123',
      SUPER_ADMIN_ROLE,
      [tree.rootId],
      'u-superadmin',
    );
    this.addUser(
      'ops@fms.local',
      'Ops User',
      'Ops@1234',
      'role-operator',
      [fleetId('North')],
      'u-ops',
    );
    this.addUser(
      'viewer@fms.local',
      'Viewer User',
      'View@1234',
      'role-viewer',
      [fleetId('Delhi Hub 1')],
      'u-viewer',
    );
    // Linked to a driver in North with a vehicle by `buildServer` (F11).
    this.addUser(
      'driver@fms.local',
      'Driver User',
      'Drive@1234',
      DRIVER_ROLE,
      [fleetId('North')],
      DRIVER_USER_ID,
    );
  }

  // ---- roles & users ----

  addRole(role: Role): Role {
    this.roles.set(role.id, role);
    return role;
  }

  role(id: string): Role {
    const role = this.roles.get(id);
    if (!role) throw new HttpError(404, 'not_found', `Role ${id} not found`);
    return role;
  }

  addUser(
    email: string,
    name: string,
    password: string,
    roleId: string,
    fleetIds: string[],
    id?: string,
  ): User {
    const salt = randomBytes(8).toString('hex');
    const user: UserRecord = {
      id: id ?? `u-${randomUUID()}`,
      email: normEmail(email),
      name,
      roleId,
      fleetIds,
      status: 'active',
      salt,
      hash: hashPassword(password, salt),
    };
    this.users.set(user.id, user);
    return this.publicUser(user);
  }

  publicUser(u: UserRecord): User {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      roleId: u.roleId,
      fleetIds: [...u.fleetIds],
      status: u.status,
    };
  }

  user(id: string): UserRecord {
    const user = this.users.get(id);
    if (!user) throw new HttpError(404, 'not_found', `User ${id} not found`);
    return user;
  }

  userByEmail(email: string): UserRecord | undefined {
    const e = normEmail(email);
    for (const u of this.users.values()) if (u.email === e) return u;
    return undefined;
  }

  permissions(user: User): Permission[] {
    return [...(this.roles.get(user.roleId)?.permissions ?? [])];
  }

  me(user: UserRecord): Me {
    return {
      user: this.publicUser(user),
      role: this.role(user.roleId),
      permissions: this.permissions(user),
      fleetIds: [...user.fleetIds],
    };
  }

  setPassword(user: UserRecord, password: string): void {
    user.hash = hashPassword(password, user.salt);
    this.endSessions(user.id);
  }

  verify(email: string, password: string): UserRecord {
    const user = this.userByEmail(email);
    const ok =
      user?.status === 'active' &&
      timingSafeEqual(
        Buffer.from(hashPassword(password, user.salt), 'hex'),
        Buffer.from(user.hash, 'hex'),
      );
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
    return user!;
  }

  // ---- sessions ----

  createSession(userId: string): string {
    const sid = token();
    this.sessions.set(sid, { userId, expiresAt: this.clock.now() + SESSION_TTL_MS });
    return sid;
  }

  /** Resolves a session id to an active user and slides its expiry. */
  touchSession(sid: string | undefined): UserRecord | undefined {
    if (!sid) return undefined;
    const session = this.sessions.get(sid);
    const user = session && this.users.get(session.userId);
    if (!session || !user || user.status !== 'active' || session.expiresAt <= this.clock.now()) {
      this.sessions.delete(sid);
      return undefined;
    }
    session.expiresAt = this.clock.now() + SESSION_TTL_MS;
    return user;
  }

  endSession(sid: string): void {
    this.sessions.delete(sid);
  }

  endSessions(userId: string): void {
    for (const [sid, s] of this.sessions) if (s.userId === userId) this.sessions.delete(sid);
  }

  // ---- mail, reset, invites ----

  private send(mail: Omit<Mail, 'sentAt'>): void {
    const full = { ...mail, sentAt: this.clock.now() };
    this.mailbox.push(full);
    if (this.mailbox.length > MAILBOX_SIZE) this.mailbox.shift();
    this.onMail(full);
  }

  requestReset(email: string): void {
    const user = this.userByEmail(email);
    if (!user || user.status !== 'active') return;
    const t = token();
    this.resets.set(t, {
      userId: user.id,
      expiresAt: this.clock.now() + RESET_TTL_MS,
      used: false,
    });
    this.send({
      to: user.email,
      kind: 'reset-password',
      subject: 'Reset your password',
      url: `/reset-password?token=${t}`,
      token: t,
    });
  }

  resetPassword(t: string, password: string): void {
    const reset = this.resets.get(t);
    if (!reset || reset.used || reset.expiresAt <= this.clock.now()) {
      throw new HttpError(410, 'gone', 'This reset link has expired or was already used');
    }
    reset.used = true;
    this.setPassword(this.user(reset.userId), password);
  }

  inviteStatus(invite: InviteRecord): Invite['status'] {
    return invite.status === 'pending' && invite.expiresAt <= this.clock.now()
      ? 'expired'
      : invite.status;
  }

  publicInvite(record: InviteRecord): Invite {
    const { id, email, roleId, fleetIds, invitedBy, createdAt, expiresAt } = record;
    return {
      id,
      email,
      roleId,
      fleetIds: [...fleetIds],
      invitedBy,
      createdAt,
      expiresAt,
      status: this.inviteStatus(record),
    };
  }

  invite(input: { email: string; roleId: string; fleetIds: string[] }, invitedBy: string): Invite {
    const email = normEmail(input.email);
    if (this.userByEmail(email))
      throw new HttpError(409, 'conflict', 'A user with this email already exists');
    for (const inv of this.invites.values()) {
      if (inv.email === email && this.inviteStatus(inv) === 'pending') {
        throw new HttpError(409, 'conflict', 'A pending invite already exists for this email');
      }
    }
    const now = this.clock.now();
    const record: InviteRecord = {
      id: `inv-${randomUUID()}`,
      email,
      roleId: input.roleId,
      fleetIds: [...input.fleetIds],
      invitedBy,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: 'pending',
      token: token(),
    };
    this.invites.set(record.id, record);
    this.mailInvite(record);
    return this.publicInvite(record);
  }

  private mailInvite(invite: InviteRecord): void {
    this.send({
      to: invite.email,
      kind: 'invite',
      subject: 'You have been invited to FMS',
      url: `/accept-invite?token=${invite.token}`,
      token: invite.token,
    });
  }

  inviteRecord(id: string): InviteRecord {
    const invite = this.invites.get(id);
    if (!invite) throw new HttpError(404, 'not_found', `Invite ${id} not found`);
    return invite;
  }

  resend(id: string): Invite {
    const invite = this.inviteRecord(id);
    if (invite.status !== 'pending')
      throw new HttpError(409, 'conflict', `Invite is ${invite.status}`);
    invite.token = token();
    invite.expiresAt = this.clock.now() + INVITE_TTL_MS;
    this.mailInvite(invite);
    return this.publicInvite(invite);
  }

  revoke(id: string): void {
    const invite = this.inviteRecord(id);
    if (invite.status === 'accepted')
      throw new HttpError(409, 'conflict', 'Invite was already accepted');
    invite.status = 'revoked';
  }

  /** A pending, unexpired invite by token, or `410`. */
  openInvite(t: string): InviteRecord {
    for (const invite of this.invites.values()) {
      if (invite.token !== t) continue;
      if (this.inviteStatus(invite) !== 'pending') {
        throw new HttpError(410, 'gone', 'This invite has expired or is no longer valid');
      }
      return invite;
    }
    throw new HttpError(410, 'gone', 'This invite has expired or is no longer valid');
  }

  acceptInvite(t: string, name: string, password: string): UserRecord {
    const invite = this.openInvite(t);
    if (this.userByEmail(invite.email))
      throw new HttpError(409, 'conflict', 'A user with this email already exists');
    const user = this.addUser(invite.email, name, password, invite.roleId, invite.fleetIds);
    invite.status = 'accepted';
    for (const listener of this.onInviteAccepted) listener(invite.id, user.id);
    return this.user(user.id);
  }
}
