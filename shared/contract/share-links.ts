import { z } from 'zod';
import { epochMsSchema } from './common.ts';

export const shareShowSchema = z.object({ drivingEnergy: z.boolean(), device: z.boolean() });
export const shareTrailSchema = z.object({
  enabled: z.boolean(),
  windowMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
});
export const shareOptionsSchema = z.object({ show: shareShowSchema, trail: shareTrailSchema });
export type ShareOptions = z.infer<typeof shareOptionsSchema>;

export const shareLinkSchema = z.object({
  id: z.string(),
  token: z.string(),
  vehicleId: z.string(),
  createdBy: z.string(),
  createdAt: epochMsSchema,
  expiresAt: epochMsSchema,
  show: shareShowSchema,
  trail: shareTrailSchema,
  revokedAt: epochMsSchema.optional(),
  url: z.string(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;
export const shareLinkListSchema = z.array(shareLinkSchema);

export const createShareLinkSchema = z.object({
  vehicleId: z.string(),
  expiresAt: epochMsSchema,
  show: shareShowSchema,
  trail: shareTrailSchema,
});

export const publicShareSchema = z.object({
  /** The shared vehicle's id: the share socket subscribes with `scope: { kind: 'vehicle', vehicleId }` (D-089). */
  vehicleId: z.string(),
  vehicle: z.object({
    regno: z.string(),
    make: z.string(),
    model: z.string(),
    variant: z.string(),
    fuelType: z.string(),
  }),
  options: shareOptionsSchema,
  expiresAt: epochMsSchema,
});
export type PublicShare = z.infer<typeof publicShareSchema>;

/** `[lng, lat, ts]` */
export const trailPointSchema = z.tuple([z.number(), z.number(), epochMsSchema]);
export const publicTrailSchema = z.object({ points: z.array(trailPointSchema) });
