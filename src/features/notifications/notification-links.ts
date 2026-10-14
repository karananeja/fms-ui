import type { Notification } from '@shared/contract/index.ts';
import { can, type PermissionHolder } from '@/features/access/permissions/can';

/** Where a notification leads (a typed TanStack Router target), or `null` for nowhere. */
export type NotificationLink = { to: '/live-tracking'; search: { vehicle: string } };

/**
 * F15-R2: kind → route. Vehicle alerts open the vehicle on Live tracking. Request kinds open the
 * vehicle too until F14 ships `/requests/:id` (then: `requestId` → the request). Unknown kinds
 * follow their `vehicleId` when there is one. Needs `live.view`, else no link.
 */
export function notificationLink(
  n: Notification,
  me: PermissionHolder | null | undefined,
): NotificationLink | null {
  if (!n.vehicleId || !can(me, 'live.view')) return null;
  return { to: '/live-tracking', search: { vehicle: n.vehicleId } };
}
