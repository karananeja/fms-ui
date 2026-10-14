import { z } from 'zod';
import { epochMsSchema } from './common.ts';

export const REQUEST_TYPES = ['breakdown', 'replacement', 'rsa'] as const;
export const requestTypeSchema = z.enum(REQUEST_TYPES);
export type RequestType = z.infer<typeof requestTypeSchema>;

export const REQUEST_STATUSES = [
  'open',
  'acknowledged',
  'dispatched',
  'waiting',
  'suggested',
  'approved',
  'assigned',
  'resolved',
  'closed',
  'rejected',
] as const;
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;
/** No further transitions from these. */
export const TERMINAL_REQUEST_STATUSES = [
  'assigned',
  'resolved',
  'closed',
  'rejected',
] as const satisfies readonly RequestStatus[];

export const BREAKDOWN_REASONS = [
  'no-gps-device',
  'battery-charging',
  'tyre',
  'accident',
  'mechanical',
  'other',
] as const;
export const breakdownReasonSchema = z.enum(BREAKDOWN_REASONS);
export type BreakdownReason = z.infer<typeof breakdownReasonSchema>;

export const REQUEST_ACTIONS = [
  'acknowledge',
  'dispatch',
  'resolve',
  'close',
  'approve',
  'override',
  'reject',
] as const;
export const requestActionSchema = z.enum(REQUEST_ACTIONS);
export type RequestAction = z.infer<typeof requestActionSchema>;

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const timelineEntrySchema = z.object({
  at: epochMsSchema,
  status: requestStatusSchema,
  /** userId, or `system`. */
  by: z.string(),
  note: z.string().optional(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const driverRequestSchema = z.object({
  id: z.string(),
  type: requestTypeSchema,
  vehicleId: z.string(),
  driverId: z.string(),
  fleetId: z.string(),
  status: requestStatusSchema,
  reason: breakdownReasonSchema.optional(),
  note: z.string(),
  /** Reported location, or the vehicle's last fix; `null` if neither is known. */
  location: geoPointSchema.nullable(),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
  /** Oldest first; the last entry's status is `status`. */
  timeline: z.array(timelineEntrySchema).min(1),
  replacement: z
    .object({ suggestedVehicleId: z.string().optional(), assignedVehicleId: z.string().optional() })
    .optional(),
  rsa: z.object({ assignee: z.string(), etaMinutes: z.number().int().positive() }).optional(),
});
export type DriverRequest = z.infer<typeof driverRequestSchema>;

/** `POST /requests` (driver): for the caller's current vehicle. `reason` is required for `breakdown`. */
export const createRequestSchema = z
  .object({
    type: requestTypeSchema,
    reason: breakdownReasonSchema.optional(),
    note: z.string().trim().max(500).default(''),
    location: geoPointSchema.optional(),
  })
  .refine((r) => r.type !== 'breakdown' || r.reason !== undefined, {
    path: ['reason'],
    message: 'reason is required for a breakdown',
  });

/** `fleetId` filters by subtree. Newest first. */
export const requestListQuerySchema = z.object({
  type: requestTypeSchema.optional(),
  status: requestStatusSchema.optional(),
  fleetId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export const requestListSchema = z.object({
  items: z.array(driverRequestSchema),
  nextCursor: z.string().nullable(),
});

/**
 * `POST /requests/:id/actions`. `dispatch` (rsa) needs `assignee` + `etaMinutes`; `override`
 * (replacement) needs `vehicleId`; `approve` takes an optional `vehicleId` (default: the suggestion).
 */
export const requestActionBodySchema = z.object({
  action: requestActionSchema,
  note: z.string().trim().max(500).optional(),
  vehicleId: z.string().optional(),
  assignee: z.string().trim().min(1).optional(),
  etaMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
});

export const replacementCandidateSchema = z.object({
  vehicleId: z.string(),
  regno: z.string(),
  status: z.enum(['stopped', 'charging']),
  distanceKm: z.number().nonnegative(),
  /** `null` for non-EVs. */
  soc: z.number().nullable(),
  rangeKm: z.number(),
});
export type ReplacementCandidate = z.infer<typeof replacementCandidateSchema>;
/** Best first, at most 5. */
export const replacementCandidateListSchema = z.array(replacementCandidateSchema).max(5);
