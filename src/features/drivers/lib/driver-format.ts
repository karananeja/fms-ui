import { PHONE_PATTERN, type Driver, type DriverStatus } from '@shared/contract/index.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "since 3 d" style duration: `< 1 min`, `12 min`, `5 h`, `3 d`. */
export function formatSince(from: number, now: number): string {
  const d = Math.max(0, now - from);
  if (d < MIN) return '< 1 min';
  if (d < HOUR) return `${Math.floor(d / MIN)} min`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h`;
  return `${Math.floor(d / DAY)} d`;
}

/** "Ravi Kumar" → "Ravi K." (the conflict warning, F12-R3). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}

/** `tel:` link for a `+91 9xxxx xxxxx` phone. */
export const telHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

export const DRIVER_STATUS_META: Record<DriverStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--ok)' },
  'off-duty': { label: 'Off duty', color: 'var(--warn)' },
  disabled: { label: 'Disabled', color: 'var(--text-faint)' },
};

export type AppAccess = 'joined' | 'invited' | 'none';

export const APP_ACCESS_LABEL: Record<AppAccess, string> = {
  joined: 'Joined',
  invited: 'Invited',
  none: 'None',
};

/**
 * F12-R1 "app access": `joined` once the invite was accepted (`userId` linked). The F11 driver
 * has no invite reference, so `invited` is known only for invites sent from this tab.
 */
export function appAccess(d: Driver, invitedIds: ReadonlySet<string>): AppAccess {
  if (d.userId) return 'joined';
  return invitedIds.has(d.id) ? 'invited' : 'none';
}

/** Client-side phone check, same rule as the contract (`+91 9xxxx xxxxx`). */
export const PHONE_HINT = '+91 98765 43210';

/** Formats digits as typed into `+91 9xxxx xxxxx` (leaves anything else as is). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length !== 10) return input.trim();
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DriverFormErrors = Partial<Record<'name' | 'phone' | 'fleet' | 'email', string>>;

/** Client checks matching the contract; the server still answers 409/422. */
export function validateDriver(v: {
  name: string;
  phone: string;
  fleetId: string | null;
  invite: boolean;
  email: string;
}): DriverFormErrors {
  const e: DriverFormErrors = {};
  if (!v.name.trim()) e.name = 'Enter the driver’s name.';
  if (!PHONE_PATTERN.test(normalizePhone(v.phone))) e.phone = `Phone must look like ${PHONE_HINT}.`;
  if (!v.fleetId) e.fleet = 'Choose a fleet.';
  if (v.invite && !EMAIL.test(v.email.trim())) e.email = 'Enter an email to send the invite to.';
  return e;
}
