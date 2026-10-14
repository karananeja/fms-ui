import type {
  AnalyticsSeries,
  AnalyticsSummary,
  DriverKpis,
  VehicleRanking,
} from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/** F16: the F11 analytics endpoints (`analytics.view`, IST days, ≤ 90 days, fleet-scoped). */

export interface AnalyticsParams {
  from: number;
  to: number;
  fleetId?: string;
  vehicleId?: string;
  driverId?: string;
  sort?: string;
  limit?: number;
}

export interface DriverRanking {
  from: number;
  to: number;
  days: number;
  total: number;
  items: DriverKpis[];
}

export function analyticsQuery(p: AnalyticsParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') qs.set(k, String(v));
  return qs.toString();
}

const get = <T>(path: string, p: AnalyticsParams, signal?: AbortSignal) =>
  apiFetch<T>(`/api/analytics/${path}?${analyticsQuery(p)}`, { signal });

export const fetchSummary = (p: AnalyticsParams, signal?: AbortSignal) =>
  get<AnalyticsSummary>('summary', p, signal);
export const fetchSeries = (p: AnalyticsParams, signal?: AbortSignal) =>
  get<AnalyticsSeries>('series', p, signal);
export const fetchVehicleRanking = (p: AnalyticsParams, signal?: AbortSignal) =>
  get<VehicleRanking>('vehicles', p, signal);
export const fetchDriverRanking = (p: AnalyticsParams, signal?: AbortSignal) =>
  get<DriverRanking>('drivers', p, signal);
