import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  type Invite,
  type Mail,
  type Me,
  type Permission,
  type Role,
  type User,
} from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import { atomic } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const RESET_TTL_MS = 30 * 60_000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAILBOX_SIZE = 200;
/** A session's stored expiry is rewritten only when it slid by at least this much (D-138). */
export const SESSION_PERSIST_MS = 60_000;

export interface UserRecord extends User {
  salt: string;
  hash: string;
}
interface InviteRecord extends Invite {
  /** SHA-256 of the invite token (the raw token only goes to the dev mailbox). */
  tokenHash: string;
  /** Driver to link when a `POST /drivers` invite is accepted (F11), else `null`. */
  driverIdx: number | null;
}
interface Session {
  userId: string;
  expiresAt: number;
  /** `expires_at` as last written to the database. */
  savedExpiresAt: number;
}
interface ResetToken {
  userId: string;
  expiresAt: number;
  used: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  permissions: string;
  system: number;
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  role_id: string;
  fleet_ids: string;
  status: User['status'];
  salt: string;
  hash: string;
}
interface InviteRow {
  id: string;
  email: string;
  role_id: string;
  fleet_ids: string;
  invited_by: string;
  created_at: number;
  expires_at: number;
  status: Invite['status'];
  token_hash: string;
  driver_idx: number | null;
}

export const token = () => randomBytes(32).toString('base64url');
/** SHA-256 of a random token: what the database and the memory maps key sessions/tokens by (D-138). */
export const hashToken = (t: string) => createHash('sha256').update(t).digest('base64url');
export const hashPassword = (password: string, salt: string) =>
  scryptSync(password, salt, 32, { N: 1024 }).toString('hex');
export const newSalt = () => randomBytes(8).toString('hex');
export const normEmail = (email: string) => email.trim().toLowerCase();

export const SUPER_ADMIN_ROLE = 'role-super-admin';
export const DRIVER_ROLE = 'role-driver';
export const DRIVER_USER_ID = 'u-driver';

const SQL = {
  insertRole: 'INSERT INTO roles (id, name, permissions, system, ord) VALUES (?, ?, ?, ?, ?)',
  updateRole: 'UPDATE roles SET name = ?, permissions = ? WHERE id = ?',
  deleteRole: 'DELETE FROM roles WHERE id = ?',
  insertUser: `INSERT INTO users (id, email, name, role_id, fleet_ids, status, salt, hash, ord)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  updateUser: 'UPDATE users SET name = ?, role_id = ?, fleet_ids = ?, status = ?, hash = ? WHERE id = ?',
  insertSession: 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  slideSession: 'UPDATE sessions SET expires_at = ? WHERE token_hash = ?',
  deleteSession: 'DELETE FROM sessions WHERE token_hash = ?',
  deleteUserSessions: 'DELETE FROM sessions WHERE user_id = ?',
  insertReset: 'INSERT INTO reset_tokens (token_hash, user_id, expires_at, used) VALUES (?, ?, ?, 0)',
  useReset: 'UPDATE reset_tokens SET used = 1 WHERE token_hash = ?',
  insertInvite: `INSERT INTO invites (id, email, role_id, fleet_ids, invited_by, created_at, expires_at,
    status, token_hash, driver_idx, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  updateInvite: 'UPDATE invites SET status = ?, token_hash = ?, expires_at = ? WHERE id = ?',
} as const;

/**
 * Users, roles, sessions, invites and reset tokens: a write-through cache over `fms.db` (F22,
 * D-136). Reads never touch SQL; each mutation writes its rows before returning. The dev mailbox
 * stays in memory.
 */
export class Accounts {
  readonly roles = new Map<string, Role>();
  readonly users = new Map<string, UserRecord>();
  readonly invites = new Map<string, InviteRecord>();
  /** By SHA-256 of the session id. */
  private readonly sessions = new Map<string, Session>();
  /** By SHA-256 of the reset token. */
  private readonly resets = new Map<string, ResetToken>();
  readonly mailbox: Mail[] = [];
  /** Called after an invite is accepted (links invited drivers to their new user). */
  readonly onInviteAccepted: ((inviteId: string, userId: string, driverIdx: number | null) => void)[] =
    [];
  private readonly stmt: Record<keyof typeof SQL, StatementSync>;
  private ord = { role: 0, user: 0, invite: 0 };

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
    private readonly onMail: (mail: Mail) => void = () => {},
  ) {
    this.stmt = Object.fromEntries(
      Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]),
    ) as Record<keyof typeof SQL, StatementSync>;
  }

  /** (Re)loads everything from the database; purges expired sessions and reset tokens first. */
  hydrate(): void {
    const { db } = this;
    const now = this.clock.now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM reset_tokens WHERE expires_at <= ?').run(now);
    this.roles.clear();
    this.users.clear();
    this.invites.clear();
    this.sessions.clear();
    this.resets.clear();
    for (const r of db.prepare('SELECT * FROM roles ORDER BY ord').all() as unknown as RoleRow[]) {
      this.roles.set(r.id, {
        id: r.id,
        name: r.name,
        permissions: JSON.parse(r.permissions) as Permission[],
        system: r.system === 1,
      });
    }
    for (const u of db.prepare('SELECT * FROM users ORDER BY ord').all() as unknown as UserRow[]) {
      this.users.set(u.id, {
        id: u.id,
        email: u.email,
        name: u.name,
        roleId: u.role_id,
        fleetIds: JSON.parse(u.fleet_ids) as string[],
        status: u.status,
        salt: u.salt,
        hash: u.hash,
      });
    }
    for (const i of db
      .prepare('SELECT * FROM invites ORDER BY ord')
      .all() as unknown as InviteRow[]) {
      this.invites.set(i.id, {
        id: i.id,
        email: i.email,
        roleId: i.role_id,
        fleetIds: JSON.parse(i.fleet_ids) as string[],
        invitedBy: i.invited_by,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
        status: i.status,
        tokenHash: i.token_hash,
        driverIdx: i.driver_idx,
      });
    }
    for (const s of db.prepare('SELECT * FROM sessions').all() as unknown as {
      token_hash: string;
      user_id: string;
      expires_at: number;
    }[]) {
      this.sessions.set(s.token_hash, {
        userId: s.user_id,
        expiresAt: s.expires_at,
        savedExpiresAt: s.expires_at,
      });
    }
    for (const r of db.prepare('SELECT * FROM reset_tokens').all() as unknown as {
      token_hash: string;
      user_id: string;
      expires_at: number;
      used: number;
    }[]) {
      this.resets.set(r.token_hash, {
        userId: r.user_id,
        expiresAt: r.expires_at,
        used: r.used === 1,
      });
    }
    const max = (table: string) =>
      (db.prepare(`SELECT COALESCE(MAX(ord), 0) AS m FROM ${table}`).get() as { m: number }).m;
    this.ord = { role: max('roles'), user: max('users'), invite: max('invites') };
  }

  private saveUser(u: UserRecord): void {
    this.stmt.updateUser.run(u.name, u.roleId, JSON.stringify(u.fleetIds), u.status, u.hash, u.id);
  }

  // ---- roles & users ----

  addRole(role: Role): Role {
    this.stmt.insertRole.run(
      role.id,
      role.name,
      JSON.stringify(role.permissions),
      role.system ? 1 : 0,
      ++this.ord.role,
    );
    this.roles.set(role.id, role);
    return role;
  }

  role(id: string): Role {
    const role = this.roles.get(id);
    if (!role) throw new HttpError(404, 'not_found', `Role ${id} not found`);
    return role;
  }

  /** Edits a custom role (callers check `system` and the permission rules first). */
  updateRole(id: string, patch: { name?: string; permissions?: Permission[] }): Role {
    const role = this.role(id);
    if (patch.name !== undefined) role.name = patch.name;
    if (patch.permissions) role.permissions = [...new Set(patch.permissions)];
    this.stmt.updateRole.run(role.name, JSON.stringify(role.permissions), role.id);
    return role;
  }

  /** `404` unknown, `409` system or still assigned to users or pending invites. */
  deleteRole(id: string): void {
    const role = this.role(id);
    if (role.system) throw new HttpError(409, 'conflict', 'System roles cannot be deleted');
    const inUse =
      [...this.users.values()].some((u) => u.roleId === role.id) ||
      [...this.invites.values()].some(
        (i) => i.roleId === role.id && this.inviteStatus(i) === 'pending',
      );
    if (inUse) throw new HttpError(409, 'conflict', 'Role is assigned to users or pending invites');
    this.stmt.deleteRole.run(role.id);
    this.roles.delete(role.id);
  }

  addUser(
    email: string,
    name: string,
    password: string,
    roleId: string,
    fleetIds: string[],
    id?: string,
  ): User {
    const salt = newSalt();
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
    this.stmt.insertUser.run(
      user.id,
      user.email,
      user.name,
      user.roleId,
      JSON.stringify(user.fleetIds),
      user.status,
      user.salt,
      user.hash,
      ++this.ord.user,
    );
    this.users.set(user.id, user);
    return this.publicUser(user);
  }

  /** Applies an admin edit (callers validate first); disabling ends the user's sessions. */
  updateUser(
    id: string,
    patch: { roleId?: string; fleetIds?: string[]; status?: User['status'] },
  ): UserRecord {
    const user = this.user(id);
    return atomic(this.db, () => {
      if (patch.roleId !== undefined) user.roleId = patch.roleId;
      if (patch.fleetIds) user.fleetIds = [...patch.fleetIds];
      if (patch.status !== undefined) user.status = patch.status;
      this.saveUser(user);
      if (patch.status === 'disabled') this.endSessions(user.id);
      return user;
    });
  }

  /** Renames a user (seeding links the driver user to its driver's name). */
  rename(id: string, name: string): void {
    const user = this.user(id);
    user.name = name;
    this.saveUser(user);
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
    atomic(this.db, () => {
      user.hash = hashPassword(password, user.salt);
      this.saveUser(user);
      this.endSessions(user.id);
    });
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
    const h = hashToken(sid);
    const expiresAt = this.clock.now() + SESSION_TTL_MS;
    this.stmt.insertSession.run(h, userId, expiresAt);
    this.sessions.set(h, { userId, expiresAt, savedExpiresAt: expiresAt });
    return sid;
  }

  /**
   * Resolves a session id to an active user and slides its expiry. No SQL unless the session is
   * dead (row deleted) or its stored expiry is a minute or more behind (D-138).
   */
  touchSession(sid: string | undefined): UserRecord | undefined {
    if (!sid) return undefined;
    const h = hashToken(sid);
    const session = this.sessions.get(h);
    if (!session) return undefined;
    const user = this.users.get(session.userId);
    const now = this.clock.now();
    if (!user || user.status !== 'active' || session.expiresAt <= now) {
      this.sessions.delete(h);
      this.stmt.deleteSession.run(h);
      return undefined;
    }
    session.expiresAt = now + SESSION_TTL_MS;
    if (Math.abs(session.expiresAt - session.savedExpiresAt) >= SESSION_PERSIST_MS) {
      this.stmt.slideSession.run(session.expiresAt, h);
      session.savedExpiresAt = session.expiresAt;
    }
    return user;
  }

  endSession(sid: string): void {
    const h = hashToken(sid);
    this.sessions.delete(h);
    this.stmt.deleteSession.run(h);
  }

  endSessions(userId: string): void {
    for (const [h, s] of this.sessions) if (s.userId === userId) this.sessions.delete(h);
    this.stmt.deleteUserSessions.run(userId);
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
    const h = hashToken(t);
    const expiresAt = this.clock.now() + RESET_TTL_MS;
    this.stmt.insertReset.run(h, user.id, expiresAt);
    this.resets.set(h, { userId: user.id, expiresAt, used: false });
    this.send({
      to: user.email,
      kind: 'reset-password',
      subject: 'Reset your password',
      url: `/reset-password?token=${t}`,
      token: t,
    });
  }

  resetPassword(t: string, password: string): void {
    const h = hashToken(t);
    const reset = this.resets.get(h);
    if (!reset || reset.used || reset.expiresAt <= this.clock.now()) {
      throw new HttpError(410, 'gone', 'This reset link has expired or was already used');
    }
    const user = this.user(reset.userId);
    atomic(this.db, () => {
      reset.used = true;
      this.stmt.useReset.run(h);
      this.setPassword(user, password);
    });
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

  invite(
    input: { email: string; roleId: string; fleetIds: string[] },
    invitedBy: string,
    opts: { driverIdx?: number } = {},
  ): Invite {
    const email = normEmail(input.email);
    if (this.userByEmail(email))
      throw new HttpError(409, 'conflict', 'A user with this email already exists');
    for (const inv of this.invites.values()) {
      if (inv.email === email && this.inviteStatus(inv) === 'pending') {
        throw new HttpError(409, 'conflict', 'A pending invite already exists for this email');
      }
    }
    const now = this.clock.now();
    const t = token();
    const record: InviteRecord = {
      id: `inv-${randomUUID()}`,
      email,
      roleId: input.roleId,
      fleetIds: [...input.fleetIds],
      invitedBy,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: 'pending',
      tokenHash: hashToken(t),
      driverIdx: opts.driverIdx ?? null,
    };
    this.stmt.insertInvite.run(
      record.id,
      record.email,
      record.roleId,
      JSON.stringify(record.fleetIds),
      record.invitedBy,
      record.createdAt,
      record.expiresAt,
      record.status,
      record.tokenHash,
      record.driverIdx,
      ++this.ord.invite,
    );
    this.invites.set(record.id, record);
    this.mailInvite(record, t);
    return this.publicInvite(record);
  }

  private saveInvite(i: InviteRecord): void {
    this.stmt.updateInvite.run(i.status, i.tokenHash, i.expiresAt, i.id);
  }

  private mailInvite(invite: InviteRecord, t: string): void {
    this.send({
      to: invite.email,
      kind: 'invite',
      subject: 'You have been invited to FMS',
      url: `/accept-invite?token=${t}`,
      token: t,
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
    const t = token();
    invite.tokenHash = hashToken(t);
    invite.expiresAt = this.clock.now() + INVITE_TTL_MS;
    this.saveInvite(invite);
    this.mailInvite(invite, t);
    return this.publicInvite(invite);
  }

  revoke(id: string): void {
    const invite = this.inviteRecord(id);
    if (invite.status === 'accepted')
      throw new HttpError(409, 'conflict', 'Invite was already accepted');
    invite.status = 'revoked';
    this.saveInvite(invite);
  }

  /** A pending, unexpired invite by token, or `410`. */
  openInvite(t: string): InviteRecord {
    const h = hashToken(t);
    for (const invite of this.invites.values()) {
      if (invite.tokenHash !== h) continue;
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
    return atomic(this.db, () => {
      const user = this.addUser(invite.email, name, password, invite.roleId, invite.fleetIds);
      invite.status = 'accepted';
      this.saveInvite(invite);
      for (const listener of this.onInviteAccepted) listener(invite.id, user.id, invite.driverIdx);
      return this.user(user.id);
    });
  }
}
