import type { TimeRange, Widget } from '@shared/contract/dashboards.ts';
import { customRequest } from './custom-requests';
import { resolveRange } from './time-range';

/**
 * §6.2 / D-131: one REST request per analytics/REST widget. `key` identifies the data (so equal
 * widgets share one cache entry); `url(now)` resolves the relative range at fetch time.
 */
export interface WidgetRequest {
  key: string;
  url(now: number): string;
}

type Params = Record<string, string | number | undefined>;

const qs = (p: Params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') s.set(k, String(v));
  return s.toString();
};

function analytics(path: string, range: TimeRange, p: Params): WidgetRequest {
  return {
    key: `${path}?range=${range}&${qs(p)}`,
    url: (now) => {
      const { from, to } = resolveRange(range, now);
      return `/api/analytics/${path}?${qs({ from, to, ...p })}`;
    },
  };
}

const fixed = (url: string): WidgetRequest => ({ key: url, url: () => url });

/** Requests are counted client-side over at most this many (F18 risk: "500+"). */
export const REQUESTS_FETCH_LIMIT = 500;

export function widgetRequest(w: Widget): WidgetRequest | null {
  switch (w.type) {
    case 'kpi':
      if (w.source === 'live') return null;
      return analytics('summary', w.range, {
        fleetId: w.fleetId,
        vehicleId: w.vehicleId,
        driverId: w.driverId,
      });
    case 'daily-chart':
      return analytics('series', w.range, {
        fleetId: w.fleetId,
        vehicleId: w.vehicleId,
        driverId: w.driverId,
      });
    case 'ranking':
      return analytics(w.entity, w.range, {
        fleetId: w.fleetId,
        sort: w.order === 'asc' ? `${w.metric}:asc` : w.metric,
        limit: w.limit,
      });
    case 'driver-list':
      return fixed(
        `/api/drivers?${qs({ status: w.status, fleetId: w.fleetId, q: w.q, limit: w.limit })}`,
      );
    case 'requests-summary':
      return fixed(
        `/api/requests?${qs({
          type: w.types?.length === 1 ? w.types[0] : undefined,
          fleetId: w.fleetId,
          limit: REQUESTS_FETCH_LIMIT,
        })}`,
      );
    case 'custom':
      return customRequest(w.spec);
    case 'status-breakdown':
    case 'vehicle-list':
    case 'text':
      return null;
    default: {
      const never: never = w;
      return never;
    }
  }
}
