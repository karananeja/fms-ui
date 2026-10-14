import type {
  Fleet,
  Invite,
  PermissionInfo,
  Role,
  User,
  VehicleMeta,
  createFleetSchema,
  createInviteSchema,
  createRoleSchema,
  updateRoleSchema,
  updateUserSchema,
} from '@shared/contract/index.ts';
import type { z } from 'zod';
import { apiFetch } from '@/shared/api/api-client';

/**
 * Typed calls for the access endpoints (F01 contract, D-028). Every call throws `ApiError`
 * on non-2xx: `status` + the server's `code` / `message`; 422 `validation_failed` carries the
 * zod issues in `details` (`[{ path, message }]`). Conflicts are 409 `conflict` (own role or
 * status, system role, role in use, non-empty fleet, invite not pending); a missing permission
 * is 403. Lists are bare arrays except `listVehicles`.
 */

export type CreateFleetInput = z.infer<typeof createFleetSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export interface VehicleListQuery {
  /** Direct members of this fleet only; omitted = every vehicle in scope. */
  fleetId?: string;
  /** Substring of vehicle ID, regno, VIN or device ID (case-insensitive). */
  q?: string;
  /** `nextCursor` of the previous page. */
  cursor?: string;
  /** 1–500, server default 50. */
  limit?: number;
}

export interface VehiclePage {
  items: VehicleMeta[];
  /** `null` on the last page. */
  nextCursor: string | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ---- permissions ----

/** `GET /api/permissions`: the catalogue with labels (any signed-in user). */
export const listPermissions = (opts?: RequestOptions) =>
  apiFetch<PermissionInfo[]>('/api/permissions', opts);

// ---- fleets ----

/** `GET /api/fleets`: flat list of the fleets in your scope, with subtree vehicle counts. */
export const listFleets = (opts?: RequestOptions) => apiFetch<Fleet[]>('/api/fleets', opts);

/** `POST /api/fleets` (201). 422 past depth 5 or for a parent out of scope. */
export const createFleet = (input: CreateFleetInput) =>
  apiFetch<Fleet>('/api/fleets', { body: input });

/** `PATCH /api/fleets/:id` with a new name. */
export const renameFleet = (id: string, name: string) =>
  apiFetch<Fleet>(`/api/fleets/${enc(id)}`, { method: 'PATCH', body: { name } });

/** `PATCH /api/fleets/:id` with a new parent. 422 into its own subtree or past depth 5. */
export const moveFleet = (id: string, parentId: string) =>
  apiFetch<Fleet>(`/api/fleets/${enc(id)}`, { method: 'PATCH', body: { parentId } });

/** `DELETE /api/fleets/:id` (204). 409 unless an empty leaf; the root can't be deleted. */
export const deleteFleet = (id: string) =>
  apiFetch<void>(`/api/fleets/${enc(id)}`, { method: 'DELETE' });

// ---- vehicles ----

/** `GET /api/vehicles`: one cursor page (`fleets.manage`). */
export const listVehicles = (q: VehicleListQuery = {}, opts?: RequestOptions) =>
  apiFetch<VehiclePage>(
    `/api/vehicles${query({ fleetId: q.fleetId, q: q.q?.trim(), cursor: q.cursor, limit: q.limit })}`,
    opts,
  );

/** `POST /api/fleets/:id/vehicles`: moves vehicles into a fleet; `moved` skips ones already there. */
export const moveVehicles = (fleetId: string, vehicleIds: string[]) =>
  apiFetch<{ moved: number }>(`/api/fleets/${enc(fleetId)}/vehicles`, { body: { vehicleIds } });

// ---- users ----

/** `GET /api/users` (`users.manage`). */
export const listUsers = (opts?: RequestOptions) => apiFetch<User[]>('/api/users', opts);

/** `PATCH /api/users/:id`. 409 when changing your own role or status; disabling ends their sessions. */
export const updateUser = (id: string, patch: UpdateUserInput) =>
  apiFetch<User>(`/api/users/${enc(id)}`, { method: 'PATCH', body: patch });

// ---- invites ----

/** `GET /api/invites` (`users.invite`), every status; filter on the client. */
export const listInvites = (opts?: RequestOptions) => apiFetch<Invite[]>('/api/invites', opts);

/** `POST /api/invites` (201). 409 "user already exists" / "pending invite exists". */
export const createInvite = (input: CreateInviteInput) =>
  apiFetch<Invite>('/api/invites', { body: input });

/** `POST /api/invites/:id/resend`: new token, expiry reset. 409 unless pending or expired. */
export const resendInvite = (id: string) =>
  apiFetch<Invite>(`/api/invites/${enc(id)}/resend`, { method: 'POST' });

/** `DELETE /api/invites/:id` (204). 409 once accepted. */
export const revokeInvite = (id: string) =>
  apiFetch<void>(`/api/invites/${enc(id)}`, { method: 'DELETE' });

// ---- roles ----

/** `GET /api/roles` (`roles.manage`). */
export const listRoles = (opts?: RequestOptions) => apiFetch<Role[]>('/api/roles', opts);

/** `POST /api/roles` (201). 422 for `users.invite` / `roles.manage` (F03-R14). */
export const createRole = (input: CreateRoleInput) => apiFetch<Role>('/api/roles', { body: input });

/** `PATCH /api/roles/:id`. 409 for system roles; 422 as for `createRole`. */
export const updateRole = (id: string, patch: UpdateRoleInput) =>
  apiFetch<Role>(`/api/roles/${enc(id)}`, { method: 'PATCH', body: patch });

/** `DELETE /api/roles/:id` (204). 409 for system roles or while users / pending invites use it. */
export const deleteRole = (id: string) =>
  apiFetch<void>(`/api/roles/${enc(id)}`, { method: 'DELETE' });

/**
 * Cache keys for access data, hierarchical so a prefix invalidates everything under it
 * (e.g. `accessKeys.fleets()` after a vehicle move, since counts change).
 */
export const accessKeys = {
  all: ['access'] as const,
  permissions: () => [...accessKeys.all, 'permissions'] as const,
  fleets: () => [...accessKeys.all, 'fleets'] as const,
  vehicles: (fleetId?: string, q?: string) =>
    [...accessKeys.all, 'vehicles', fleetId ?? null, q?.trim() || null] as const,
  users: () => [...accessKeys.all, 'users'] as const,
  invites: () => [...accessKeys.all, 'invites'] as const,
  roles: () => [...accessKeys.all, 'roles'] as const,
};
