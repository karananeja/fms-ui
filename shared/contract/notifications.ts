import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * `no-gps-24h` goes to `live.view` users whose scope holds the vehicle. `request-*` and
 * `replacement-waiting` go to `requests.manage` users in scope, and (except `request-created`)
 * to the requesting driver.
 */
export const NOTIFICATION_KINDS = [
  'no-gps-24h',
  'request-created',
  'request-updated',
  'replacement-waiting',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const notificationSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  severity: notificationSeveritySchema,
  title: z.string(),
  body: z.string(),
  fleetId: z.string(),
  vehicleId: z.string().optional(),
  requestId: z.string().optional(),
  createdAt: epochMsSchema,
  /** Per user: when the caller read it, or `null`. */
  readAt: epochMsSchema.nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
/** Newest first. `unreadCount` counts every unread notification the caller may see. */
export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});

export const markNotificationsReadSchema = z.union([
  z.object({ ids: z.array(z.string()).min(1) }),
  z.object({ all: z.literal(true) }),
]);
export const markNotificationsReadResultSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
