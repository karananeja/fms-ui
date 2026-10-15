import { z } from 'zod';
import { epochMsSchema } from './common.ts';
import { assignmentSchema } from './drivers.ts';
import { notificationSchema } from './notifications.ts';
import { redactedCombinfoSchema, redactedLafparsedSchema } from './payloads.ts';
import { driverRequestSchema } from './requests.ts';

export * from './ws-protocol.ts';

/**
 * `events` (F11, low volume, consumed on the main thread): notifications, requests and
 * assignments. Staff subscribe it with a fleet scope; drivers with `{ kind: 'self' }`.
 */
export const topicSchema = z.enum(['combinfo', 'lafparsed', 'events', 'dashboard']);
export type Topic = z.infer<typeof topicSchema>;

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fleet'), fleetIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('vehicle'), vehicleId: z.string() }),
  /** Only with topic `events`: the signed-in driver's own events. */
  z.object({ kind: z.literal('self') }),
  /** F27 (D-153): only with topic `dashboard`: one dashboard the user can open. */
  z.object({ kind: z.literal('dashboard'), dashboardId: z.string().min(1).max(64) }),
]);
export type Scope = z.infer<typeof scopeSchema>;

export const subscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  id: z.string().min(1),
  topic: topicSchema,
  scope: scopeSchema,
  pids: z.array(z.string()).optional(),
});
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  subscribeMessageSchema,
  z.object({ type: z.literal('unsubscribe'), id: z.string() }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

const str = z.string();
const num = z.number();
const ts = epochMsSchema;
/** Per-column value schemas; any other column (a lafparsed PID) is `number | null`. */
export const FIELD_SCHEMAS: Record<string, z.ZodType> = {
  vehicleId: str,
  deviceId: str,
  regno: str,
  vin: str,
  fleetId: str.nullable(),
  assetType: str,
  fuelType: str,
  make: str,
  model: str,
  variant: str,
  lat: num,
  lng: num,
  speed: num,
  heading: num,
  ignstatus: num,
  carbattery: num,
  devbattery: num,
  fixquality: num,
  utctime: ts,
  gpstime: ts,
  canutctime: ts,
  soc: num,
  dte: num,
  odometer: num,
  immobilization_status: num,
  displayStatus: str,
};
const pidValue = num.nullable();

export function rowSchema(fields: readonly string[]) {
  return z.tuple(fields.map((f) => FIELD_SCHEMAS[f] ?? pidValue) as [z.ZodType, ...z.ZodType[]]);
}

const rowsSchema = z.array(z.array(z.unknown()));

export const EVENT_KINDS = ['notification', 'request', 'assignment'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** `events` topic message; `data` is validated by the schema of its `kind`. */
export const eventMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    type: z.literal('event'),
    id: z.string(),
    kind: z.literal('notification'),
    data: notificationSchema,
  }),
  z.object({
    type: z.literal('event'),
    id: z.string(),
    kind: z.literal('request'),
    data: driverRequestSchema,
  }),
  z.object({
    type: z.literal('event'),
    id: z.string(),
    kind: z.literal('assignment'),
    data: assignmentSchema,
  }),
]);
export type EventMessage = z.infer<typeof eventMessageSchema>;

/** F27 (D-153): `dashboard` topic events (low volume, main thread; no chat content). */
const dashboardActorSchema = z.object({ userId: z.string(), name: z.string() });
export const dashboardEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('changed'),
    dashboardId: z.string(),
    version: z.number().int().min(1),
    by: dashboardActorSchema,
    at: ts,
    summary: z.string(),
  }),
  z.object({
    kind: z.literal('assistant'),
    dashboardId: z.string(),
    running: z.boolean(),
    by: dashboardActorSchema.nullable(),
  }),
  /** Only to the affected user; `null` = access removed (the subscription ends). */
  z.object({
    kind: z.literal('access'),
    dashboardId: z.string(),
    access: z.enum(['editor', 'viewer']).nullable(),
  }),
  z.object({ kind: z.literal('deleted'), dashboardId: z.string() }),
]);
export type DashboardLiveEvent = z.infer<typeof dashboardEventSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribed'), id: z.string() }),
  z.object({
    type: z.literal('snapshot'),
    id: z.string(),
    seq: z.number().int().positive(),
    chunk: z.number().int().nonnegative(),
    chunks: z.number().int().positive(),
    fields: z.array(z.string()),
    rows: rowsSchema,
  }),
  z.object({
    type: z.literal('delta'),
    id: z.string(),
    seq: z.number().int().positive(),
    fields: z.array(z.string()),
    rows: rowsSchema,
  }),
  z.object({
    type: z.literal('payload'),
    id: z.string(),
    topic: z.enum(['combinfo', 'lafparsed']),
    data: z.union([redactedCombinfoSchema, redactedLafparsedSchema]),
  }),
  eventMessageSchema,
  z.object({ type: z.literal('dashboard'), id: z.string(), event: dashboardEventSchema }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('heartbeat'), ts }),
  z.object({
    type: z.literal('error'),
    id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
