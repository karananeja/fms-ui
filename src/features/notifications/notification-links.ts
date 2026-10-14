import type { Notification } from '@shared/contract/index.ts';
import { can, type PermissionHolder } from '@/features/access/permissions/can';

/** Where a notification leads (a typed TanStack Router target), or `null` for nowhere. */
export type NotificationLink =
  | { to: '/live-tracking'; search: { vehicle: string } }
  | { to: '/requests/$requestId'; params: { requestId: string } };

/**
 * F15-R2 / F14: kind → route. A notification about a request (`requestId`) opens it on the
 * request desk for `requests.manage` users. Otherwise (vehicle alerts, or no desk access) it
 * opens the vehicle on Live tracking, which needs `live.view`; else no link.
 */
export function notificationLink(
  n: Notification,
  me: PermissionHolder | null | undefined,
): NotificationLink | null {
  if (n.requestId && can(me, 'requests.manage'))
    return { to: '/requests/$requestId', params: { requestId: n.requestId } };
  if (!n.vehicleId || !can(me, 'live.view')) return null;
  return { to: '/live-tracking', search: { vehicle: n.vehicleId } };
}
