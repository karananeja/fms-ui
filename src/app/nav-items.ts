import {
  Building2,
  ChartColumn,
  IdCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  MailPlus,
  MapPinned,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  can,
  ROUTE_PERMISSIONS as P,
  type AppPath,
  type PermissionCheck,
  type PermissionHolder,
} from '@/features/access/permissions/can';
import { RequestsNavBadge } from '@/features/requests/components/requests-nav-badge';

export interface NavItem {
  to: AppPath;
  label: string;
  icon: LucideIcon;
  /** Shown only with this permission (any of a list); the route guard checks the same one. */
  permission: PermissionCheck;
  /** A live count shown on the item (rail: corner dot; drawer: right-aligned). */
  badge?: ComponentType<{ variant: 'rail' | 'drawer' }>;
}

export const navItems: NavItem[] = [
  {
    to: '/live-tracking',
    label: 'Live tracking',
    icon: MapPinned,
    permission: P['/live-tracking'],
  },
  {
    to: '/requests',
    label: 'Requests',
    icon: Inbox,
    permission: P['/requests'],
    badge: RequestsNavBadge,
  },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn, permission: P['/analytics'] },
  {
    to: '/dashboards',
    label: 'Dashboards',
    icon: LayoutDashboard,
    permission: P['/dashboards'],
  },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, permission: P['/admin'] },
  { to: '/admin/fleets', label: 'Fleets', icon: Building2, permission: P['/admin/fleets'] },
  { to: '/admin/users', label: 'Users', icon: Users, permission: P['/admin/users'] },
  { to: '/admin/drivers', label: 'Drivers', icon: IdCard, permission: P['/admin/drivers'] },
  { to: '/admin/invites', label: 'Invites', icon: MailPlus, permission: P['/admin/invites'] },
  { to: '/admin/roles', label: 'Roles', icon: KeyRound, permission: P['/admin/roles'] },
  {
    to: '/admin/share-links',
    label: 'Share links',
    icon: Link2,
    permission: P['/admin/share-links'],
  },
];

/** F03-R2: the items `me` may open (the Admin entry needs any admin permission). */
export const visibleNavItems = (me: PermissionHolder | null | undefined): NavItem[] =>
  navItems.filter((item) => can(me, item.permission));
