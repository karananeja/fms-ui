import type { TimeRange } from '@shared/contract/dashboards.ts';
import { istDayStart } from '@/features/analytics/lib/chart-scale';

const DAY = 86_400_000;

/**
 * §6.2: relative ranges in IST. `today` = IST midnight → now; `yesterday` = the previous IST day;
 * `7d`/`30d`/`90d` = the last N IST days including today (same days as F16).
 */
export function resolveRange(range: TimeRange, now: number): { from: number; to: number } {
  const today = istDayStart(now);
  switch (range) {
    case 'today':
      return { from: today, to: now };
    case 'yesterday':
      return { from: today - DAY, to: today };
    case '7d':
    case '30d':
    case '90d': {
      const days = Number(range.slice(0, -1));
      return { from: today - (days - 1) * DAY, to: now };
    }
  }
}

export const RANGE_LABEL: Record<TimeRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};
