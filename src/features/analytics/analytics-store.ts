import type { AnalyticsSeries, AnalyticsSummary, VehicleRanking } from '@shared/contract/index.ts';
import {
  analyticsQuery,
  fetchDriverRanking,
  fetchSeries,
  fetchSummary,
  fetchVehicleRanking,
  type AnalyticsParams,
  type DriverRanking,
} from './api/analytics-api';
import { previousWindow, type Tab } from './lib/analytics-model';

export interface AnalyticsView {
  tab: Tab;
  params: AnalyticsParams;
  /** Ranking sort key (KPI field or `score`) and direction. */
  sort: string;
  asc: boolean;
  limit: number;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  previous: AnalyticsSummary | null;
  series: AnalyticsSeries;
  ranking: VehicleRanking | DriverRanking;
}

export interface AnalyticsState {
  key: string;
  data: AnalyticsData | null;
  loading: boolean;
  error: unknown;
}

export interface AnalyticsApi {
  summary: typeof fetchSummary;
  series: typeof fetchSeries;
  vehicles: typeof fetchVehicleRanking;
  drivers: typeof fetchDriverRanking;
}

const defaultApi: AnalyticsApi = {
  summary: fetchSummary,
  series: fetchSeries,
  vehicles: fetchVehicleRanking,
  drivers: fetchDriverRanking,
};

const CACHE_MAX = 40;

/**
 * F16-R1 / D-104: loads one analytics view (summary, previous-period summary, daily series and
 * ranking). Results are cached per query; a new view aborts the requests of the previous one.
 */
export class AnalyticsStore {
  private state: AnalyticsState = { key: '', data: null, loading: false, error: null };
  private readonly listeners = new Set<() => void>();
  private readonly cache = new Map<string, unknown>();
  private ctrl: AbortController | null = null;
  /** Requests sent (tests check cache hits). */
  requests = 0;

  constructor(private readonly api: AnalyticsApi = defaultApi) {}

  getSnapshot = (): AnalyticsState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  static keyOf(v: AnalyticsView): string {
    return `${v.tab}|${analyticsQuery(v.params)}|${v.sort}:${v.asc ? 'asc' : 'desc'}|${v.limit}`;
  }

  async load(view: AnalyticsView): Promise<void> {
    const key = AnalyticsStore.keyOf(view);
    if (key === this.state.key && (this.state.data || this.state.loading)) return;
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.set({ key, loading: true, error: null, data: this.state.data });
    try {
      const { params } = view;
      const prev = { ...params, ...previousWindow(params) };
      const sort = `${view.sort}${view.asc ? ':asc' : ''}`;
      const rankParams = { ...params, sort, limit: view.limit };
      const [summary, previous, series, ranking] = await Promise.all([
        this.cached('summary', params, ctrl.signal, this.api.summary),
        this.cached('summary', prev, ctrl.signal, this.api.summary).catch(() => null),
        this.cached('series', params, ctrl.signal, this.api.series),
        view.tab === 'vehicles'
          ? this.cached('vehicles', rankParams, ctrl.signal, this.api.vehicles)
          : this.cached('drivers', rankParams, ctrl.signal, this.api.drivers),
      ]);
      if (ctrl.signal.aborted) return;
      this.set({ key, loading: false, error: null, data: { summary, previous, series, ranking } });
    } catch (error) {
      if (ctrl.signal.aborted) return;
      this.set({ key, loading: false, error, data: this.state.data });
    }
  }

  /** One request through the cache (shared by every view that asks the same thing). */
  async cached<T>(
    path: string,
    params: AnalyticsParams,
    signal: AbortSignal,
    fetcher: (p: AnalyticsParams, s?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = `${path}?${analyticsQuery(params)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit as T;
    this.requests++;
    const value = await fetcher(params, signal);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, value);
    return value;
  }

  private set(s: AnalyticsState): void {
    this.state = s;
    for (const l of [...this.listeners]) l();
  }
}
