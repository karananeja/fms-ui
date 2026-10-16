import { SYSTEM_ONLY_PERMISSIONS, type Permission } from '@shared/contract/index.ts';

/** F03-R10: the role editor's groups, in display order. */
export const PERMISSION_GROUPS: readonly { label: string; permissions: readonly Permission[] }[] = [
  { label: 'Live', permissions: ['live.view'] },
  { label: 'Vehicle', permissions: ['vehicle.details.view', 'vehicle.parameters.view'] },
  { label: 'Table', permissions: ['table.view', 'table.export'] },
  { label: 'Share', permissions: ['share.create', 'share.revoke'] },
  {
    label: 'Admin',
    permissions: ['users.invite', 'users.manage', 'fleets.manage', 'roles.manage', 'audit.view'],
  },
  { label: 'Drivers', permissions: ['drivers.manage', 'requests.manage', 'driver.self'] },
  { label: 'Insights', permissions: ['analytics.view', 'chat.use', 'dashboards.use'] },
];

/** F03-R10/R14 (B8): never grantable to a custom role. */
export const isSystemOnly = (p: Permission) =>
  (SYSTEM_ONLY_PERMISSIONS as readonly Permission[]).includes(p);

export const SYSTEM_ONLY_REASON = 'Only Super Admin can invite users or manage roles.';
