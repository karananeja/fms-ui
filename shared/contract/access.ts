import { z } from 'zod';
import { epochMsSchema } from './common.ts';
import { permissionSchema } from './permissions.ts';

export const MAX_FLEET_DEPTH = 5;

export const fleetSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  depth: z.number().int().min(1).max(MAX_FLEET_DEPTH),
  vehicleCount: z.number().int().nonnegative(),
});
export type Fleet = z.infer<typeof fleetSchema>;
export const fleetListSchema = z.array(fleetSchema);

export const createFleetSchema = z.object({ parentId: z.string(), name: z.string().trim().min(1) });
export const updateFleetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  parentId: z.string().optional(),
});

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(permissionSchema),
  system: z.boolean(),
});
export type Role = z.infer<typeof roleSchema>;
export const roleListSchema = z.array(roleSchema);
export const createRoleSchema = z.object({
  name: z.string().trim().min(1),
  permissions: z.array(permissionSchema),
});
export const updateRoleSchema = createRoleSchema.partial();

export const userStatusSchema = z.enum(['active', 'disabled']);
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roleId: z.string(),
  fleetIds: z.array(z.string()),
  status: userStatusSchema,
});
export type User = z.infer<typeof userSchema>;
export const userListSchema = z.array(userSchema);
export const updateUserSchema = z.object({
  roleId: z.string().optional(),
  fleetIds: z.array(z.string()).min(1).optional(),
  status: userStatusSchema.optional(),
});

export const inviteStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string(),
  fleetIds: z.array(z.string()),
  invitedBy: z.string(),
  createdAt: epochMsSchema,
  expiresAt: epochMsSchema,
  status: inviteStatusSchema,
});
export type Invite = z.infer<typeof inviteSchema>;
export const inviteListSchema = z.array(inviteSchema);
export const createInviteSchema = z.object({
  email: z.email(),
  roleId: z.string(),
  fleetIds: z.array(z.string()).min(1),
});

export const vehicleMetaSchema = z.object({
  vehicleId: z.string(),
  deviceId: z.string(),
  regno: z.string(),
  vin: z.string().length(17),
  fleetId: z.string(),
  assetType: z.string(),
  fuelType: z.string(),
  make: z.string(),
  model: z.string(),
  variant: z.string(),
});
export type VehicleMeta = z.infer<typeof vehicleMetaSchema>;

export const vehicleListQuerySchema = z.object({
  fleetId: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export const vehicleListSchema = z.object({
  items: z.array(vehicleMetaSchema),
  nextCursor: z.string().nullable(),
});
export const moveVehiclesSchema = z.object({ vehicleIds: z.array(z.string()).min(1) });
export const moveVehiclesResultSchema = z.object({ moved: z.number().int().nonnegative() });
