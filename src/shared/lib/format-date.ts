const istParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Formats an epoch-ms timestamp as `DD MMM YY | HH:mm:ss` in IST. */
export function formatIst(epochMs: number): string {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of istParts.formatToParts(epochMs)) p[type] = value;
  return `${p.day} ${p.month} ${p.year} | ${p.hour}:${p.minute}:${p.second}`;
}
