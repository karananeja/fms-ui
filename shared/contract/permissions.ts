import { z } from 'zod';

export const PERMISSIONS = [
  'live.view',
  'vehicle.details.view',
  'vehicle.parameters.view',
  'table.view',
  'table.export',
  'share.create',
  'share.revoke',
  'users.invite',
  'users.manage',
  'fleets.manage',
  'roles.manage',
  'drivers.manage',
  'requests.manage',
  'analytics.view',
  'chat.use',
  'dashboards.use',
  'driver.self',
  'audit.view',
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export const permissionInfoSchema = z.object({ id: permissionSchema, label: z.string() });
export type PermissionInfo = z.infer<typeof permissionInfoSchema>;

export const permissionCatalogueSchema = z.array(permissionInfoSchema);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'live.view': 'View live tracking',
  'vehicle.details.view': 'View vehicle details',
  'vehicle.parameters.view': 'View vehicle parameters',
  'table.view': 'View table',
  'table.export': 'Export CSV',
  'share.create': 'Create share links',
  'share.revoke': 'Revoke share links',
  'users.invite': 'Invite users',
  'users.manage': 'Manage users',
  'fleets.manage': 'Manage fleets',
  'roles.manage': 'Manage roles',
  'drivers.manage': 'Manage drivers',
  'requests.manage': 'Manage driver requests',
  'analytics.view': 'View analytics',
  'chat.use': 'Use the assistant',
  'dashboards.use': 'Use dashboards',
  'driver.self': 'Driver self-service',
  'audit.view': 'View activity log',
};

/** F03-R14 (B8): permissions only system roles (Super Admin) may hold; custom roles can't. */
export const SYSTEM_ONLY_PERMISSIONS = [
  'users.invite',
  'roles.manage',
] as const satisfies readonly Permission[];
