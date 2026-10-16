import type {
  ActionArea,
  ActionStatus,
  ActionTarget,
  AuditStatus,
} from '@shared/contract/index.ts';
import {
  Bell,
  Building2,
  IdCard,
  Inbox,
  KeyRound,
  Link2,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export const AREA_LABEL: Record<ActionArea, string> = {
  drivers: 'Drivers',
  requests: 'Requests',
  users: 'Users',
  roles: 'Roles',
  fleets: 'Fleets',
  sharing: 'Sharing',
  notifications: 'Notifications',
  settings: 'Settings',
};

export const AREA_ICON: Record<ActionArea, LucideIcon> = {
  drivers: IdCard,
  requests: Inbox,
  users: Users,
  roles: KeyRound,
  fleets: Building2,
  sharing: Link2,
  notifications: Bell,
  settings: Settings,
};

/** Theme-token colours for status pills (no palette classes). */
export const AUDIT_STATUS: Record<AuditStatus, { label: string; color: string }> = {
  done: { label: 'Done', color: 'var(--ok)' },
  undone: { label: 'Undone', color: 'var(--text-muted)' },
  undo: { label: 'Undo', color: 'var(--warn)' },
  logged: { label: 'Logged', color: 'var(--accent)' },
};

export const ACTION_STATUS: Record<ActionStatus, { label: string; color: string }> = {
  proposed: { label: 'Needs confirmation', color: 'var(--warn)' },
  done: { label: 'Done', color: 'var(--ok)' },
  failed: { label: 'Failed', color: 'var(--danger)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
  expired: { label: 'Expired', color: 'var(--text-muted)' },
  undone: { label: 'Undone', color: 'var(--text-muted)' },
};

/** The admin page that shows a target (`null`: no page, e.g. notifications). */
export function targetHref(t: ActionTarget | null): string | null {
  if (!t) return null;
  switch (t.type) {
    case 'driver':
      return '/admin/drivers';
    case 'user':
      return '/admin/users';
    case 'invite':
      return '/admin/invites';
    case 'role':
      return '/admin/roles';
    case 'fleet':
    case 'vehicle':
      return '/admin/fleets';
    case 'request':
      return `/requests/${encodeURIComponent(t.id)}`;
    case 'share_link':
      return '/admin/share-links';
    default:
      return null;
  }
}

const IST_OFFSET_MS = 330 * 60_000;
/** `YYYY-MM-DD` (an IST calendar day) → epoch ms of its start (or end, inclusive). */
export function istDayMs(day: string, edge: 'start' | 'end'): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_OFFSET_MS;
  return edge === 'start' ? start : start + 24 * 60 * 60_000 - 1;
}
