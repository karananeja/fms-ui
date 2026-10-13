import {
  Building2,
  KeyRound,
  MailPlus,
  MapPinned,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to:
    | '/live-tracking'
    | '/admin'
    | '/admin/fleets'
    | '/admin/users'
    | '/admin/invites'
    | '/admin/roles';
  label: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { to: '/live-tracking', label: 'Live tracking', icon: MapPinned },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
  { to: '/admin/fleets', label: 'Fleets', icon: Building2 },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/invites', label: 'Invites', icon: MailPlus },
  { to: '/admin/roles', label: 'Roles', icon: KeyRound },
];
