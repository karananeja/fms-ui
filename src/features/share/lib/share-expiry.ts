/**
 * F10-R2: share-link expiry. Presets resolve against `now`; a custom expiry is a date + time
 * read and shown in IST (UTC+05:30, no DST), at least 5 min and at most 30 days ahead.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = 330 * MIN;

export const MIN_LEAD_MS = 5 * MIN;
export const MAX_AHEAD_MS = 30 * DAY;

export type ExpiryPreset = '1h' | '6h' | '24h' | '7d' | 'custom';

export const EXPIRY_PRESETS: readonly { value: ExpiryPreset; label: string; ms?: number }[] = [
  { value: '1h', label: '1 h', ms: HOUR },
  { value: '6h', label: '6 h', ms: 6 * HOUR },
  { value: '24h', label: '24 h', ms: DAY },
  { value: '7d', label: '7 days', ms: 7 * DAY },
  { value: 'custom', label: 'Custom' },
];

export const DEFAULT_EXPIRY: ExpiryPreset = '24h';

/** `<input type="date">` / `<input type="time">` values, in IST. */
export interface IstInput {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` (24 h) */
  time: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → IST date and time input values (seconds dropped). */
export function epochToIstInput(at: number): IstInput {
  const d = new Date(at + IST_OFFSET_MS);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** IST date + time input values → epoch ms; `null` when either is missing or malformed. */
export function istInputToEpoch({ date, time }: IstInput): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  // Reject roll-overs such as 31 Feb.
  if (new Date(utc).getUTCDate() !== d) return null;
  return utc - IST_OFFSET_MS;
}

/** The inline error for an expiry, or `null` when it is allowed. */
export function expiryError(at: number, now: number): string | null {
  if (at < now + MIN_LEAD_MS) return 'Pick a time at least 5 min from now.';
  if (at > now + MAX_AHEAD_MS) return 'Links can last at most 30 days.';
  return null;
}

export type ResolvedExpiry =
  { expiresAt: number; error: null } | { expiresAt: null; error: string };

/** The expiry a preset or a custom IST date/time stands for at `now`. */
export function resolveExpiry(preset: ExpiryPreset, custom: IstInput, now: number): ResolvedExpiry {
  if (preset !== 'custom') {
    const ms = EXPIRY_PRESETS.find((p) => p.value === preset)!.ms!;
    return { expiresAt: now + ms, error: null };
  }
  const at = istInputToEpoch(custom);
  if (at === null) return { expiresAt: null, error: 'Enter a date and time.' };
  const error = expiryError(at, now);
  return error ? { expiresAt: null, error } : { expiresAt: at, error: null };
}

const istLabel = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "15 Oct, 6:30 pm IST" */
export function formatExpiryIst(at: number): string {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of istLabel.formatToParts(at)) p[type] = value;
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()} IST`;
}
