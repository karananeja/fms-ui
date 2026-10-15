import type {
  AnalyticsSeries,
  DriverRequest,
  Notification,
} from '@shared/contract/index.ts';
import {
  DATASETS,
  KPI_FIELDS,
  REST_FETCH_LIMIT,
  type CustomSpec,
} from '@shared/contract/index.ts';
import type { Cell } from '@shared/domain/widget-shape.ts';
import { resolveRange } from './time-range';
import type { WidgetRequest } from './widget-queries';

/**
 * F26 (D-145): one existing endpoint per REST dataset, fetched with the viewer's session; the
 * response becomes plain rows of the grammar's fields (then `applyShape` on the client).
 */

type Params = Record<string, string | number | undefined>;
const qs = (p: Params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') s.set(k, String(v));
  return s.toString();
};
const fixed = (url: string): WidgetRequest => ({ key: url, url: () => url });

const KPI_SET = new Set<string>([...KPI_FIELDS, 'score']);

/** The KPI an analytics-ranking request sorts by (what the widget aggregates or plots). */
export function rankingSort(spec: CustomSpec): string {
  const s = spec.shape;
  const entity = spec.data.entity ?? 'vehicles';
  const pick = [s?.aggregate?.field, s?.sort?.by, spec.mark.y, ...(spec.mark.columns ?? [])].find(
    (f) => f && KPI_SET.has(f) && (f !== 'score' || entity === 'drivers'),
  );
  const key = pick ?? (entity === 'drivers' ? 'score' : 'distanceKm');
  const asc = !s?.groupBy && !s?.aggregate && s?.sort?.by === key && s.sort.dir === 'asc';
  return asc ? `${key}:asc` : key;
}

export function customRequest(spec: CustomSpec): WidgetRequest | null {
  const d = spec.data;
  const range = d.range ?? '7d';
  switch (d.dataset) {
    case 'live-vehicles':
      return null;
    case 'vehicle-history':
      return d.vehicle
        ? fixed(`/api/vehicles/${encodeURIComponent(d.vehicle)}/trail?minutes=${d.minutes ?? 60}`)
        : null;
    case 'analytics-series':
    case 'analytics-ranking': {
      const path =
        d.dataset === 'analytics-series'
          ? 'series'
          : (d.entity ?? 'vehicles') === 'drivers'
            ? 'drivers'
            : 'vehicles';
      const p: Params =
        d.dataset === 'analytics-series'
          ? { fleetId: d.fleetId, vehicleId: d.vehicle, driverId: d.driverId }
          : { fleetId: d.fleetId, sort: rankingSort(spec), limit: REST_FETCH_LIMIT };
      return {
        key: `custom:${path}?range=${range}&${qs(p)}`,
        url: (now) => {
          const { from, to } = resolveRange(range, now);
          return `/api/analytics/${path}?${qs({ from, to, ...p })}`;
        },
      };
    }
    case 'drivers':
      return fixed(`/api/drivers?${qs({ fleetId: d.fleetId, limit: REST_FETCH_LIMIT })}`);
    case 'requests':
      return fixed(`/api/requests?${qs({ fleetId: d.fleetId, limit: REST_FETCH_LIMIT })}`);
    case 'notifications':
      return fixed('/api/notifications?limit=200');
  }
}

export interface RestRows {
  rows: Record<string, Cell>[];
  /** The endpoint had more rows than were read (ranking top 500). */
  truncated: boolean;
}

type KpiRow = { kpis: Record<string, number> };

/** Response → grammar rows; `now` resolves the time range of requests / notifications. */
export function restRows(spec: CustomSpec, data: unknown, now: number): RestRows {
  const d = spec.data;
  const from = resolveRange(d.range ?? '7d', now).from;
  switch (d.dataset) {
    case 'vehicle-history': {
      const pts = (data as { points: [number, number, number][] }).points ?? [];
      return { rows: pts.map(([lng, lat, time]) => ({ time, lat, lng })), truncated: false };
    }
    case 'analytics-series':
      return {
        rows: (data as AnalyticsSeries).points.map((p) => ({ day: p.start, ...p.kpis })),
        truncated: false,
      };
    case 'analytics-ranking': {
      const r = data as {
        total: number;
        items: (KpiRow & {
          vehicleId?: string;
          regno?: string;
          driverId?: string;
          name?: string;
          fleetId: string;
          score?: number | null;
        })[];
      };
      const rows = r.items.map((it) =>
        (d.entity ?? 'vehicles') === 'drivers'
          ? { driverId: it.driverId!, name: it.name!, fleet: it.fleetId, score: it.score ?? null, ...it.kpis }
          : { vehicleId: it.vehicleId!, regno: it.regno!, fleet: it.fleetId, ...it.kpis },
      );
      return { rows, truncated: r.total > r.items.length };
    }
    case 'drivers': {
      const r = data as {
        items: { id: string; name: string; phone: string; fleetId: string; status: string; createdAt: number }[];
        nextCursor: string | null;
      };
      return {
        rows: r.items.map((x) => ({
          driverId: x.id,
          name: x.name,
          phone: x.phone,
          fleet: x.fleetId,
          status: x.status,
          createdAt: x.createdAt,
        })),
        truncated: r.nextCursor !== null && r.items.length >= REST_FETCH_LIMIT,
      };
    }
    case 'requests': {
      const r = data as { items: DriverRequest[] };
      return {
        rows: r.items
          .filter((x) => x.createdAt >= from)
          .map((x) => ({
            requestId: x.id,
            vehicleId: x.vehicleId,
            driverId: x.driverId,
            fleet: x.fleetId,
            type: x.type,
            status: x.status,
            reason: x.reason ?? null,
            createdAt: x.createdAt,
            updatedAt: x.updatedAt,
          })),
        truncated: false,
      };
    }
    case 'notifications': {
      const r = data as { items: Notification[] };
      return {
        rows: r.items
          .filter((x) => x.createdAt >= from)
          .map((x) => ({
            kind: x.kind,
            severity: x.severity,
            title: x.title,
            fleet: x.fleetId,
            vehicleId: x.vehicleId ?? null,
            read: x.readAt ? 'yes' : 'no',
            createdAt: x.createdAt,
          })),
        truncated: false,
      };
    }
    case 'live-vehicles':
      return { rows: [], truncated: false };
  }
}

/** Time field of the spec's dataset (for `timeBucket`). */
export const timeFieldOf = (spec: CustomSpec) => DATASETS[spec.data.dataset].timeField;
