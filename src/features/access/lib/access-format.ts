import type { Fleet, Role } from '@shared/contract/index.ts';
import { ApiError } from '@/shared/api/api-client';
import { formatIst } from '@/shared/lib/format-date';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "in 3 h", "in 6 d" (past or future relative to `now`). */
export function formatRelativeTime(at: number, now: number): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < MIN) return 'just now';
  const text =
    abs < HOUR
      ? `${Math.floor(abs / MIN)} min`
      : abs < 2 * DAY
        ? `${Math.floor(abs / HOUR)} h`
        : `${Math.floor(abs / DAY)} d`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** Absolute IST time for a tooltip / second line: `DD MMM YY | HH:mm IST`. */
export const formatIstShort = (at: number) => `${formatIst(at).slice(0, -3)} IST`;

/** Fleet names for a scope: the first `max`, then "+N". Unknown ids show as the id. */
export function fleetScopeLabel(
  fleetIds: readonly string[],
  fleetsById: ReadonlyMap<string, Fleet>,
  max = 2,
): string {
  if (fleetIds.length === 0) return '—';
  const names = fleetIds.map((id) => fleetsById.get(id)?.name ?? id);
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

export const byId = <T extends { id: string }>(items: readonly T[] | undefined) =>
  new Map((items ?? []).map((i) => [i.id, i]));

/** A role's name, or its id when the roles list isn't readable (needs `roles.manage`). */
export const roleName = (roleId: string, rolesById: ReadonlyMap<string, Role>) =>
  rolesById.get(roleId)?.name ?? roleId;

/** The message to show for a failed call. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.unreachable ? "Couldn't reach the server. Try again." : err.message;
  }
  return 'Something went wrong. Try again.';
}
