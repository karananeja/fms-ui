const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Age of `at` relative to `now`: "just now", "2 min ago", "31 h ago", "3 d ago"; "—" if unknown. */
export function formatRelative(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—';
  const age = Math.max(0, now - at);
  if (age < MIN) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MIN)} min ago`;
  if (age < 2 * DAY) return `${Math.floor(age / HOUR)} h ago`;
  return `${Math.floor(age / DAY)} d ago`;
}
