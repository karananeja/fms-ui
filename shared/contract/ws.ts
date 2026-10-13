import { z } from 'zod';
import { epochMsSchema } from './common.ts';
import { redactedCombinfoSchema, redactedLafparsedSchema } from './payloads.ts';

export const WS_PATH = '/ws/live';
export const WS_CLOSE = { unauthenticated: 4401, forbidden: 4403, gone: 4410 } as const;
export const HEARTBEAT_MS = 15_000;

export const topicSchema = z.enum(['combinfo', 'lafparsed']);
export type Topic = z.infer<typeof topicSchema>;

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fleet'), fleetIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('vehicle'), vehicleId: z.string() }),
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

/** Fleet-scope `combinfo` columns. Deltas carry `vehicleId` + live fields only. */
export const COMBINFO_META_FIELDS = [
  'vehicleId',
  'deviceId',
  'regno',
  'vin',
  'fleetId',
  'assetType',
  'fuelType',
  'make',
  'model',
  'variant',
] as const;
export const COMBINFO_LIVE_FIELDS = [
  'lat',
  'lng',
  'speed',
  'heading',
  'ignstatus',
  'carbattery',
  'devbattery',
  'fixquality',
  'utctime',
  'gpstime',
  'canutctime',
  'soc',
  'dte',
  'odometer',
  'immobilization_status',
] as const;
export const COMBINFO_SNAPSHOT_FIELDS = [...COMBINFO_META_FIELDS, ...COMBINFO_LIVE_FIELDS];
export const COMBINFO_DELTA_FIELDS = ['vehicleId', ...COMBINFO_LIVE_FIELDS];
/** Sent when a vehicle leaves the subscription's scope (`fleetId` is `null`). */
export const COMBINFO_LEAVE_FIELDS = ['vehicleId', 'fleetId'];
export const LAFPARSED_BASE_FIELDS = ['deviceId', 'canutctime'] as const;

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
    topic: topicSchema,
    data: z.union([redactedCombinfoSchema, redactedLafparsedSchema]),
  }),
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
