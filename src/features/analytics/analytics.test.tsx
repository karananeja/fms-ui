import type { AnalyticsSummary, Kpis } from '@shared/contract/index.ts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsStore, type AnalyticsApi, type AnalyticsView } from './analytics-store';
import { DayChart } from './components/day-chart';
import { KpiTiles } from './components/kpi-tiles';
import { VEHICLE_TILES, parseFilters, toSearch, windowOf } from './lib/analytics-model';
import {
  dayTickIndices,
  formatCompact,
  formatNum,
  istDate,
  istDayStart,
  niceTicks,
} from './lib/chart-scale';

const zero: Kpis = {
  distanceKm: 0,
  driveMs: 0,
  idleMs: 0,
  uptimeMs: 0,
  downtimeMs: 0,
  noGpsMs: 0,
  energyKwh: 0,
  chargeSessions: 0,
  breakdowns: 0,
  harshBrake: 0,
  harshAccel: 0,
  overspeed: 0,
};

describe('F16-T1: chart scale', () => {
  it('nice ticks, IST days, en-IN numbers', () => {
    expect(niceTicks(0, 97)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // 18:30 UTC is IST midnight.
    expect(istDate(Date.UTC(2026, 9, 13, 18, 30))).toBe('2026-10-14');
    expect(istDayStart(Date.UTC(2026, 9, 14, 3))).toBe(Date.UTC(2026, 9, 13, 18, 30));
    expect(formatNum(123456)).toBe('1,23,456');
    expect(formatCompact(250000)).toBe('2.5L');
    expect(dayTickIndices(30, 6).at(-1)).toBe(29);
  });

  it('filters round-trip through the URL; custom windows cap at 90 days', () => {
    const f = parseFilters({ tab: 'drivers', range: '7d', fleet: 'f2' });
    expect(toSearch(f)).toEqual({ tab: 'drivers', range: '7d', fleet: 'f2' });
    expect(toSearch(parseFilters({}))).toEqual({});
    const now = Date.UTC(2026, 9, 14);
    const w = windowOf(
      { tab: 'vehicles', range: 'custom', from: '2026-01-01', to: '2026-10-13' },
      now,
    );
    expect(w.to - w.from).toBe(90 * 86_400_000);
  });
});

describe('F16-T1: analytics store', () => {
  const summary = { kpis: zero } as AnalyticsSummary;
  const api = (): AnalyticsApi => ({
    summary: vi.fn(async () => summary),
    series: vi.fn(async () => ({ from: 0, to: 1, days: 1, points: [] })),
    vehicles: vi.fn(async () => ({ from: 0, to: 1, days: 1, total: 0, items: [] })),
    drivers: vi.fn(async () => ({ from: 0, to: 1, days: 1, total: 0, items: [] })),
  });
  const view = (from: number): AnalyticsView => ({
    tab: 'vehicles',
    params: { from, to: from + 86_400_000 },
    sort: 'distanceKm',
    asc: false,
    limit: 10,
  });

  it('loads a view, hits the cache when it comes back, aborts the one replaced', async () => {
    const a = api();
    const store = new AnalyticsStore(a);
    await store.load(view(0));
    expect(store.getSnapshot().data?.summary).toBe(summary);
    const sent = store.requests;
    const pending = store.load(view(1e9));
    await store.load(view(0)); // replaces the pending view (aborted)
    await pending;
    expect(store.getSnapshot().key).toBe(AnalyticsStore.keyOf(view(0)));
    expect(vi.mocked(a.summary).mock.calls.at(-1)![1]!.aborted).toBe(true);
    expect(store.requests).toBeGreaterThan(sent);
    // Both views are cached now: switching back and forth sends nothing.
    const again = store.requests;
    await store.load(view(1e9));
    await store.load(view(0));
    expect(store.requests).toBe(again);
  });
});

describe('F16-T2: tiles and charts', () => {
  it('tiles show the value and the delta vs the previous period', () => {
    render(
      <KpiTiles
        defs={VEHICLE_TILES.slice(0, 1)}
        kpis={{ ...zero, distanceKm: 1200 }}
        previous={{ ...zero, distanceKm: 1000 }}
        series={null}
      />,
    );
    expect(screen.getByTestId('tile-value')).toHaveTextContent('1,200');
    expect(screen.getByTestId('tile-delta')).toHaveTextContent('▲ 20.0%');
  });

  it('a chart renders bars, a tooltip on keyboard focus, a table fallback, and an empty state', () => {
    const days = ['2026-10-12', '2026-10-13', '2026-10-14'];
    const { container, rerender } = render(
      <DayChart
        title="Daily distance"
        kind="bars"
        unit="km"
        days={days}
        series={[{ label: 'Distance', color: 'red', values: [10, 20, 30] }]}
      />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('12 Oct');
    expect(screen.getByRole('table', { hidden: true })).toHaveTextContent('2026-10-14');
    rerender(
      <DayChart
        title="Daily distance"
        kind="bars"
        unit="km"
        days={days}
        series={[{ label: 'Distance', color: 'red', values: [0, 0, null] }]}
      />,
    );
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
  });
});
