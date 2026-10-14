import { z } from 'zod';
import { vehicleMetaSchema } from './access.ts';
import { epochMsSchema } from './common.ts';
import { driverRequestSchema } from './requests.ts';
import { COMBINFO_LIVE_FIELDS } from './ws-protocol.ts';

export const DRIVER_STATUSES = ['active', 'off-duty', 'disabled'] as const;
export const driverStatusSchema = z.enum(DRIVER_STATUSES);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

/** `+91 9xxxx xxxxx` */
export const PHONE_PATTERN = /^\+91 [6-9]\d{4} \d{5}$/;

export const driverSchema = z.object({
  id: z.string(),
  /** The linked user (role Driver), once an invite was accepted. */
  userId: z.string().nullable(),
  name: z.string(),
  phone: z.string(),
  fleetId: z.string(),
  status: driverStatusSchema,
  createdAt: epochMsSchema,
});
export type Driver = z.infer<typeof driverSchema>;

/** `fleetId` filters by subtree; `q` matches name or phone. */
export const driverListQuerySchema = z.object({
  q: z.string().optional(),
  fleetId: z.string().optional(),
  status: driverStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export const driverListSchema = z.object({
  items: z.array(driverSchema),
  nextCursor: z.string().nullable(),
});

export const createDriverSchema = z
  .object({
    name: z.string().trim().min(1),
    phone: z.string().regex(PHONE_PATTERN, 'Phone must look like +91 9xxxx xxxxx'),
    fleetId: z.string(),
    status: driverStatusSchema.default('active'),
    /** Also sends an F03 invite with role Driver to `email`; `userId` is linked on accept. */
    invite: z.boolean().default(false),
    email: z.email().optional(),
  })
  .refine((d) => !d.invite || d.email !== undefined, {
    path: ['email'],
    message: 'email is required to invite the driver',
  });
export const updateDriverSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().regex(PHONE_PATTERN, 'Phone must look like +91 9xxxx xxxxx').optional(),
  fleetId: z.string().optional(),
  status: driverStatusSchema.optional(),
});

export const assignmentSchema = z.object({
  id: z.string(),
  driverId: z.string(),
  vehicleId: z.string(),
  from: epochMsSchema,
  to: epochMsSchema.nullable(),
  /** userId, or `system` (seed data, auto-assigned replacements). */
  by: z.string(),
});
export type Assignment = z.infer<typeof assignmentSchema>;
/** Newest first. */
export const assignmentListSchema = z.array(assignmentSchema);
export const assignmentQuerySchema = z
  .object({ vehicleId: z.string().optional(), driverId: z.string().optional() })
  .refine((q) => q.vehicleId !== undefined || q.driverId !== undefined, {
    message: 'vehicleId or driverId is required',
  });
export const setAssignmentSchema = z.object({ vehicleId: z.string() });

/** `GET /vehicles/:id/driver`: the current driver, or `null`. */
export const vehicleDriverSchema = driverSchema.nullable();

export const fleetSettingsSchema = z.object({
  fleetId: z.string(),
  autoAssignReplacement: z.boolean(),
  /** Set on this fleet (`true`) or inherited from the nearest ancestor that sets it (`false`). */
  overridden: z.boolean(),
});
export type FleetSettings = z.infer<typeof fleetSettingsSchema>;
/** `null` clears this fleet's override (inherit again). */
export const updateFleetSettingsSchema = z.object({
  autoAssignReplacement: z.boolean().nullable(),
});

/** Latest live values of the driver's vehicle (the `combinfo` live fields plus `charging`). */
export const driverVehicleLiveSchema = z.object(
  Object.fromEntries([...COMBINFO_LIVE_FIELDS, 'charging'].map((f) => [f, z.number()])) as Record<
    (typeof COMBINFO_LIVE_FIELDS)[number] | 'charging',
    z.ZodNumber
  >,
);
export const driverMeSchema = z.object({
  driver: driverSchema,
  vehicle: z.object({ meta: vehicleMetaSchema, live: driverVehicleLiveSchema }).nullable(),
  openRequests: z.array(driverRequestSchema),
});
export type DriverMe = z.infer<typeof driverMeSchema>;
