import type { Permission } from '@shared/contract/index.ts';
import { useSession } from '@/features/auth/session/use-session';

/** One permission, or a list meaning "any of these". */
export type PermissionCheck = Permission | readonly Permission[];

/** Anything carrying the signed-in user's permissions: `me`, or the live store's state. */
export type PermissionHolder = { readonly permissions: readonly Permission[] };

/** The permissions that open an admin page; holding any of them shows `/admin` (F03-R2). */
export const ADMIN_PERMISSIONS = [
  'fleets.manage',
  'users.manage',
  'users.invite',
  'roles.manage',
  'share.revoke',
  'drivers.manage',
] as const satisfies readonly Permission[];

/**
 * F03-R1/R2: what each signed-in page needs, in landing order (live tracking, requests, then the
 * admin pages in nav order). The router guards and the nav both read it.
 */
export const ROUTE_PERMISSIONS = {
  '/live-tracking': 'live.view',
  '/requests': 'requests.manage',
  '/analytics': 'analytics.view',
  '/admin': ADMIN_PERMISSIONS,
  '/admin/fleets': 'fleets.manage',
  '/admin/users': 'users.manage',
  '/admin/drivers': 'drivers.manage',
  '/admin/invites': 'users.invite',
  '/admin/roles': 'roles.manage',
  '/admin/share-links': 'share.revoke',
} as const satisfies Record<string, PermissionCheck>;

export type AppPath = keyof typeof ROUTE_PERMISSIONS;

/** F03-R1: the one permission check. Signed out (`null`) can do nothing. */
export function can(me: PermissionHolder | null | undefined, permission: PermissionCheck): boolean {
  if (!me) return false;
  return typeof permission === 'string'
    ? me.permissions.includes(permission)
    : permission.some((p) => me.permissions.includes(p));
}

/** `can` for the signed-in user (F02 `SessionStore`); re-renders when the session changes. */
export function useCan(permission: PermissionCheck): boolean {
  return useSession((s) => can(s.me, permission));
}

/** F03-R2: the default landing and the No access link; `null` when no page is allowed. */
export function firstAllowedPath(me: PermissionHolder | null | undefined): AppPath | null {
  for (const [path, permission] of Object.entries(ROUTE_PERMISSIONS)) {
    if (can(me, permission)) return path as AppPath;
  }
  return null;
}
