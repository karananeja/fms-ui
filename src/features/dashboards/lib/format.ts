import { istDayStart } from '@/features/analytics/lib/chart-scale';
import { formatIst } from '@/shared/lib/format-date';

const DAY = 86_400_000;

/** `14:32 IST` today, `Yesterday 14:32 IST`, else `12 Oct 26 14:32 IST`. */
export function formatUpdated(t: number, now: number): string {
  const full = formatIst(t); // `DD MMM YY | HH:mm:ss`
  const [date, time] = full.split(' | ') as [string, string];
  const hm = `${time.slice(0, 5)} IST`;
  const day = istDayStart(t);
  const today = istDayStart(now);
  if (day === today) return hm;
  if (day === today - DAY) return `Yesterday ${hm}`;
  return `${date} ${hm}`;
}

export const widgetCountText = (n: number) => `${n} widget${n === 1 ? '' : 's'}`;
