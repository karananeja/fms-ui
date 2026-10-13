import { z } from 'zod';
import { epochMsSchema } from './common.ts';

export const pidSchema = z.strictObject({
  pidvalue: z.number(),
  valtype: z.number().int(),
  timestamp: epochMsSchema,
});
export type Pid = z.infer<typeof pidSchema>;

export const PARSED_CAN_KEYS = [
  'current',
  'dte',
  'engine_speed',
  'immobilization_status',
  'motor_temperature',
  'odometer',
  'soc',
  'vehicle_mode_status',
] as const;

const parsedCanSchema = z.strictObject(
  Object.fromEntries(PARSED_CAN_KEYS.map((k) => [k, pidSchema])) as Record<
    (typeof PARSED_CAN_KEYS)[number],
    typeof pidSchema
  >,
);

/** Vehicle-scope `combinfo`, shaped exactly like `caninfo.md`. */
export const combinfoSchema = z.strictObject({
  deviceid: z.string(),
  vehicleid: z.string(),
  regno: z.string(),
  chasiss: z.string(),
  assettypeid: z.string(),
  assettype: z.string(),
  appmeta: z.strictObject({
    Swapable: z.string(),
    fueltype: z.string(),
    kwh: z.string(),
    legacy_accountid: z.string(),
    legacy_appmeta: z.strictObject({
      manufacturer: z.string(),
      model: z.string(),
      variant: z.string(),
    }),
    legacy_isdeleted: z.boolean(),
    transmission: z.string(),
    voltage: z.string(),
  }),
  proctime: epochMsSchema,
  utctime: epochMsSchema,
  gpstime: epochMsSchema,
  kafkatime: epochMsSchema,
  latitude: z.number(),
  longitude: z.number(),
  speed: z.number(),
  heading: z.number(),
  carbattery: z.number(),
  devbattery: z.number(),
  ignstatus: z.number().int(),
  lastvalidfix: z.number(),
  fixquality: z.number().int(),
  devstate: z.number().int(),
  rxdbm: z.number(),
  lastignon: epochMsSchema,
  lastignoff: epochMsSchema,
  canutctime: epochMsSchema,
  parsedcandata: parsedCanSchema,
  displayStatus: z.string().optional(),
});
export type Combinfo = z.infer<typeof combinfoSchema>;

/** Vehicle-scope `lafparsed`, shaped exactly like `lafparsed.md` (374 PIDs in `candata`). */
export const lafparsedSchema = z.strictObject({
  candata: z.record(z.string(), pidSchema),
  deviceid: z.string(),
  kafkatime: epochMsSchema,
  msgtimestamp: epochMsSchema,
  plsign: z.string(),
  proctime: epochMsSchema,
  uptime: z.number().int(),
});
export type Lafparsed = z.infer<typeof lafparsedSchema>;

/** Share-link groups and the keys each one removes from payloads when hidden. */
export const SHARE_GROUP_KEYS = {
  drivingEnergy: {
    combinfo: ['speed'],
    parsedcandata: [
      'current',
      'dte',
      'engine_speed',
      'motor_temperature',
      'odometer',
      'soc',
      'vehicle_mode_status',
    ],
  },
  device: { combinfo: ['deviceid', 'carbattery', 'devbattery', 'rxdbm'], parsedcandata: [] },
} as const satisfies Record<
  string,
  { combinfo: readonly (keyof Combinfo)[]; parsedcandata: readonly (typeof PARSED_CAN_KEYS)[number][] }
>;

/** Payloads as a share socket may receive them (hidden groups removed). */
export const redactedCombinfoSchema = combinfoSchema
  .partial({ speed: true, deviceid: true, carbattery: true, devbattery: true, rxdbm: true })
  .extend({ parsedcandata: parsedCanSchema.partial() });
export const redactedLafparsedSchema = lafparsedSchema.partial({ deviceid: true });
