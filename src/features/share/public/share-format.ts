const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ist = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** `15 Oct, 6:30 pm IST` */
export function formatIstShort(epochMs: number): string {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of ist.formatToParts(epochMs)) p[type] = value;
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()} IST`;
}

/** Time left until `at`: "in 5 h", "in 23 min", "in 3 d", "in < 1 min"; "now" once past. */
export function formatTimeLeft(at: number, now: number): string {
  const left = at - now;
  if (left <= 0) return 'now';
  if (left < MIN) return 'in < 1 min';
  if (left < HOUR) return `in ${Math.floor(left / MIN)} min`;
  if (left < 10 * HOUR) {
    const h = Math.floor(left / HOUR);
    const m = Math.floor((left % HOUR) / MIN);
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  if (left < 2 * DAY) return `in ${Math.floor(left / HOUR)} h`;
  return `in ${Math.floor(left / DAY)} d`;
}

/** Age of `at`: "just now", "2 min ago", "31 h ago", "3 d ago". */
export function formatAge(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < MIN) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MIN)} min ago`;
  if (age < 2 * DAY) return `${Math.floor(age / HOUR)} h ago`;
  return `${Math.floor(age / DAY)} d ago`;
}

/** F10-R11: the LIVE pill turns into "Last update …" after this long without data. */
export const STALE_AFTER_MS = 2 * MIN;
