import type { Dashboard, DashboardLayout, Widget } from '@shared/contract/dashboards.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { QueryCache } from './data/query-cache';
import { resolveRange } from './data/time-range';
import { widgetRequest } from './data/widget-queries';
import { LiveWidgetSource } from './live/live-widget-source';
import { arrangeStep, breakpointFor, rebaseLayout, sanitizeItems } from './lib/layout';
import { DashboardSession, LAYOUT_DEBOUNCE_MS } from './store/dashboard-session';

const H = 3_600_000;
// 2026-10-15 00:00 IST = 2026-10-14 18:30 UTC.
const IST_MIDNIGHT = Date.UTC(2026, 9, 14, 18, 30);
const DAY = 24 * H;

describe('F20-T2: time ranges in IST', () => {
  it('today / yesterday / Nd around midnight IST and UTC', () => {
    const justAfter = IST_MIDNIGHT + 60_000; // 00:01 IST
    expect(resolveRange('today', justAfter)).toEqual({ from: IST_MIDNIGHT, to: justAfter });
    expect(resolveRange('yesterday', justAfter)).toEqual({
      from: IST_MIDNIGHT - DAY,
      to: IST_MIDNIGHT,
    });
    const justBefore = IST_MIDNIGHT - 60_000; // 23:59 IST the day before
    expect(resolveRange('today', justBefore).from).toBe(IST_MIDNIGHT - DAY);
    // UTC midnight (05:30 IST) is still the same IST day.
    const utcMidnight = Date.UTC(2026, 9, 15);
    expect(resolveRange('today', utcMidnight).from).toBe(IST_MIDNIGHT);
    expect(resolveRange('7d', utcMidnight)).toEqual({
      from: IST_MIDNIGHT - 6 * DAY,
      to: utcMidnight,
    });
    expect(resolveRange('30d', utcMidnight).from).toBe(IST_MIDNIGHT - 29 * DAY);
    expect(resolveRange('90d', utcMidnight).from).toBe(IST_MIDNIGHT - 89 * DAY);
  });
});

const now = IST_MIDNIGHT + 2 * H;
const w = <T extends Widget>(x: Omit<T, 'id' | 'title'> & Partial<T>) =>
  ({ id: 'w-1', title: 'T', ...x }) as T;

describe('F20-T2: widget → request URL', () => {
  it('each catalogue type maps to its exact URL', () => {
    const url = (x: Widget) => widgetRequest(x)?.url(now) ?? null;
    expect(url(w({ type: 'kpi', source: 'analytics', metric: 'distanceKm', range: 'today' }))).toBe(
      `/api/analytics/summary?from=${IST_MIDNIGHT}&to=${now}`,
    );
    expect(
      url(
        w({
          type: 'kpi',
          source: 'analytics',
          metric: 'score',
          range: 'yesterday',
          driverId: 'd1',
        }),
      ),
    ).toBe(`/api/analytics/summary?from=${IST_MIDNIGHT - DAY}&to=${IST_MIDNIGHT}&driverId=d1`);
    expect(url(w({ type: 'kpi', source: 'live', status: 'running' }))).toBeNull();
    expect(
      url(
        w({
          type: 'daily-chart',
          chart: 'bar',
          metrics: ['distanceKm'],
          range: '7d',
          fleetId: 'f1',
          vehicleId: 'v1',
        }),
      ),
    ).toBe(
      `/api/analytics/series?from=${IST_MIDNIGHT - 6 * DAY}&to=${now}&fleetId=f1&vehicleId=v1`,
    );
    expect(
      url(
        w({
          type: 'ranking',
          entity: 'vehicles',
          metric: 'idleMs',
          order: 'asc',
          limit: 10,
          range: '30d',
        }),
      ),
    ).toBe(
      `/api/analytics/vehicles?from=${IST_MIDNIGHT - 29 * DAY}&to=${now}&sort=idleMs%3Aasc&limit=10`,
    );
    expect(
      url(
        w({
          type: 'ranking',
          entity: 'drivers',
          metric: 'score',
          order: 'desc',
          limit: 5,
          range: '7d',
          fleetId: 'f2',
        }),
      ),
    ).toBe(
      `/api/analytics/drivers?from=${IST_MIDNIGHT - 6 * DAY}&to=${now}&fleetId=f2&sort=score&limit=5`,
    );
    expect(url(w({ type: 'driver-list', status: 'active', q: 'ra', limit: 10 }))).toBe(
      '/api/drivers?status=active&q=ra&limit=10',
    );
    expect(
      url(
        w({
          type: 'requests-summary',
          groupBy: 'status',
          types: ['breakdown'],
          openOnly: true,
          display: 'counts',
          limit: 10,
        }),
      ),
    ).toBe('/api/requests?type=breakdown&limit=500');
    expect(
      url(
        w({
          type: 'requests-summary',
          groupBy: 'type',
          types: ['breakdown', 'rsa'],
          openOnly: false,
          display: 'latest',
          limit: 10,
          fleetId: 'f1',
        }),
      ),
    ).toBe('/api/requests?fleetId=f1&limit=500');
    expect(url(w({ type: 'status-breakdown', display: 'donut' }))).toBeNull();
    expect(url(w({ type: 'text', body: 'x' }))).toBeNull();
  });

  it('equal widgets share one request (dedupe), refresh keeps the data', async () => {
    const fetch = vi.fn(async (u: string) => ({ u }));
    const cache = new QueryCache({ fetch, now: () => now });
    const a = widgetRequest(
      w({ type: 'kpi', source: 'analytics', metric: 'distanceKm', range: '7d' }),
    )!;
    const b = widgetRequest(
      w({ id: 'w-2', type: 'kpi', source: 'analytics', metric: 'idleMs', range: '7d' }),
    )!;
    expect(a.key).toBe(b.key);
    const offA = cache.subscribe(a, () => {});
    const offB = cache.subscribe(b, () => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.get(a.key).data).toEqual({ u: a.url(now) });
    cache.refresh();
    expect(cache.get(a.key)).toMatchObject({ loading: true, data: { u: a.url(now) } });
    offA();
    offB();
    expect(cache.get(a.key).loading).toBe(true); // gone: back to the empty entry
  });
});

// ---- F20-T3: DashboardSession ----

const LG = (y = 0) => [{ i: 'w-a', x: 0, y, w: 3, h: 2, minW: 2, minH: 2 }];
const dash = (version: number, over: Partial<Dashboard> = {}): Dashboard => ({
  id: 'd1',
  ownerId: 'u1',
  ownerName: 'Ops',
  title: 'Fleet',
  description: '',
  widgets: [{ id: 'w-a', type: 'text', title: 'A', body: 'x' }],
  layout: { lg: LG(), md: LG(), sm: [{ i: 'w-a', x: 0, y: 0, w: 1, h: 2 }] },
  version,
  createdAt: 1,
  updatedAt: 1,
  access: 'owner',
  ...over,
});

function fakeApi(start: Dashboard) {
  let server = start;
  const patches: Record<string, unknown>[] = [];
  const pending: { resolve(): void; reject(e: unknown): void }[] = [];
  let mode: 'auto' | 'manual' = 'auto';
  let failWith: unknown = null;
  const api = {
    get: vi.fn(async () => server),
    patch: vi.fn((_id: string, body: Record<string, unknown>) => {
      patches.push(body);
      const apply = () => {
        if (failWith) throw failWith;
        if (body.version !== server.version) throw new ApiError(409, 'version_conflict', 'changed');
        const { version: _v, ...rest } = body;
        void _v;
        server = { ...server, ...(rest as Partial<Dashboard>), version: server.version + 1 };
        return server;
      };
      if (mode === 'auto') return Promise.resolve().then(apply);
      return new Promise<Dashboard>((res, rej) =>
        pending.push({
          resolve: () => {
            try {
              res(apply());
            } catch (e) {
              rej(e);
            }
          },
          reject: rej,
        }),
      );
    }),
  };
  return {
    api,
    patches,
    pending,
    manual: () => (mode = 'manual'),
    fail: (e: unknown) => (failWith = e),
    setServer: (d: Dashboard) => (server = d),
    get server() {
      return server;
    },
  };
}

const flush = async () => {
  for (let k = 0; k < 6; k++) await Promise.resolve();
};

describe('F20-T3: DashboardSession (D-130)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const layout = (y: number): DashboardLayout => ({
    lg: LG(y),
    md: LG(),
    sm: [{ i: 'w-a', x: 0, y: 0, w: 1, h: 2 }],
  });

  it('no save on load; 800 ms debounce coalesces drags into one PATCH with all breakpoints', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    expect(f.api.patch).not.toHaveBeenCalled();
    s.scheduleLayout(layout(2));
    vi.advanceTimersByTime(400);
    s.scheduleLayout(layout(4));
    expect(s.getSnapshot().saveState).toBe('pending');
    expect(s.getSnapshot().dashboard!.layout.lg[0]!.y).toBe(4); // optimistic
    vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS);
    await flush();
    expect(f.patches).toEqual([{ version: 1, layout: layout(4) }]);
    expect(s.getSnapshot()).toMatchObject({ saveState: 'saved' });
    expect(s.version).toBe(2);
  });

  it('serial queue carries the returned version', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    f.manual();
    s.setTitle('One');
    s.setWidgetTitle('w-a', 'Alpha');
    expect(f.patches.length).toBe(1);
    expect(s.getSnapshot()).toMatchObject({ saveState: 'saving' });
    expect(s.getSnapshot().dashboard).toMatchObject({ title: 'One' });
    expect(s.getSnapshot().dashboard!.widgets[0]!.title).toBe('Alpha');
    f.pending.shift()!.resolve();
    await flush();
    expect(f.patches[1]).toMatchObject({ version: 2 });
    f.pending.shift()!.resolve();
    await flush();
    expect(s.version).toBe(3);
    expect(s.getSnapshot().saveState).toBe('saved');
  });

  it('409 → GET + notice, queue cleared', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    f.setServer(dash(5, { title: 'Elsewhere' }));
    s.setTitle('Mine');
    s.scheduleLayout(layout(3));
    await flush();
    await flush();
    expect(f.api.get).toHaveBeenCalledTimes(2);
    expect(s.getSnapshot()).toMatchObject({ noticeVersion: 1, saveState: 'saved' });
    expect(s.getSnapshot().dashboard).toMatchObject({ title: 'Elsewhere', version: 5 });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(f.patches.length).toBe(1); // the debounced layout was discarded
  });

  it('5xx → retries 2/4/8 s, then manual Retry', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    f.fail(new ApiError(500, 'internal', 'boom'));
    s.setTitle('X');
    await flush();
    expect(s.getSnapshot().saveState).toBe('error');
    for (const ms of [2000, 4000, 8000]) {
      vi.advanceTimersByTime(ms);
      await flush();
    }
    expect(f.patches.length).toBe(4);
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(f.patches.length).toBe(4);
    expect(s.getSnapshot().saveState).toBe('error');
    f.fail(null);
    s.retry();
    await flush();
    expect(s.getSnapshot()).toMatchObject({ saveState: 'saved' });
    expect(f.server.title).toBe('X');
  });

  it('adoptRemote rebases a pending layout onto the new version; stale responses ignored', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    s.scheduleLayout(layout(3));
    // The chat added widget w-b (server v2).
    const remote = dash(2, {
      widgets: [...dash(1).widgets, { id: 'w-b', type: 'text', title: 'B', body: 'y' }],
      layout: {
        lg: [...LG(), { i: 'w-b', x: 3, y: 0, w: 4, h: 2 }],
        md: [...LG(), { i: 'w-b', x: 3, y: 0, w: 3, h: 2 }],
        sm: [
          { i: 'w-a', x: 0, y: 0, w: 1, h: 2 },
          { i: 'w-b', x: 0, y: 2, w: 1, h: 2 },
        ],
      },
    });
    f.setServer(remote);
    s.adoptRemote(remote);
    expect(s.getSnapshot().dashboard!.widgets.length).toBe(2);
    s.adoptRemote(dash(1)); // older: ignored
    expect(s.version).toBe(2);
    vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS);
    await flush();
    expect(f.patches[0]).toMatchObject({ version: 2 });
    const sent = f.patches[0]!.layout as DashboardLayout;
    expect(sent.lg).toEqual([LG(3)[0], { i: 'w-b', x: 3, y: 0, w: 4, h: 2 }]);
  });

  it('a 409 after a newer remote version re-sends instead of reloading', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    f.manual();
    s.setTitle('Mine');
    const remote = dash(2, { title: 'AI' });
    f.setServer(remote);
    s.adoptRemote(remote);
    f.pending.shift()!.resolve(); // 409 (sent with v1)
    await flush();
    expect(f.patches[1]).toMatchObject({ version: 2, title: 'Mine' });
    f.pending.shift()!.resolve();
    await flush();
    expect(f.api.get).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().dashboard!.title).toBe('Mine');
  });

  it('widget remove is optimistic; Undo restores widgets + layout', async () => {
    const f = fakeApi(dash(1));
    const s = new DashboardSession('d1', f.api);
    await s.load();
    const undo = s.removeWidget('w-a');
    expect(s.getSnapshot().dashboard!.widgets).toEqual([]);
    await flush();
    expect(f.patches[0]).toEqual({ version: 1, widgets: [] });
    undo();
    await flush();
    expect(f.patches[1]).toMatchObject({
      version: 2,
      widgets: dash(1).widgets,
      layout: dash(1).layout,
    });
  });
});

describe('F20 layout maths', () => {
  it('sanitise drops RGL fields and clamps x + w ≤ cols; breakpoints by container width', () => {
    const items = sanitizeItems(
      [{ i: 'w-a', x: 5, y: 0.4, w: 4, h: 30, minW: 2, moved: true, static: false } as never],
      'md',
    );
    expect(items).toEqual([{ i: 'w-a', x: 2, y: 0, w: 4, h: 24, minW: 2 }]);
    expect(breakpointFor(984)).toBe('lg'); // 1440 px window with the dock open
    expect(breakpointFor(700)).toBe('md');
    expect(breakpointFor(358)).toBe('sm');
  });

  it('keyboard steps move and resize within the grid; rebase keeps new widgets', () => {
    const items = [{ i: 'w-a', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }];
    expect(arrangeStep(items, 'w-a', 'ArrowLeft', false, 'lg')[0]).toMatchObject({ x: 0 });
    expect(arrangeStep(items, 'w-a', 'ArrowRight', false, 'lg')[0]).toMatchObject({ x: 1 });
    expect(arrangeStep(items, 'w-a', 'ArrowLeft', true, 'lg')[0]).toMatchObject({ w: 2 });
    expect(arrangeStep(items, 'w-a', 'ArrowDown', true, 'lg')[0]).toMatchObject({ h: 3 });
    const server: DashboardLayout = {
      lg: [
        { i: 'w-a', x: 0, y: 0, w: 3, h: 2 },
        { i: 'w-b', x: 3, y: 0, w: 3, h: 2 },
      ],
      md: [],
      sm: [],
    };
    const pending: DashboardLayout = { lg: [{ i: 'w-a', x: 6, y: 1, w: 3, h: 2 }], md: [], sm: [] };
    expect(rebaseLayout(pending, server, ['w-a', 'w-b']).lg).toEqual([
      { i: 'w-a', x: 6, y: 1, w: 3, h: 2 },
      { i: 'w-b', x: 3, y: 0, w: 3, h: 2 },
    ]);
  });
});

describe('F20: live widget source (D-129)', () => {
  it('polls once per tick for all widgets, sinceVersion short-circuit, unavailable without worker', async () => {
    const calls: [number, number | undefined][] = [];
    let version = 1;
    const port = {
      running: true,
      queryWidgets: vi.fn(async (qs: unknown[], since?: number) => {
        calls.push([qs.length, since]);
        return {
          version,
          ready: true,
          results:
            since === version
              ? null
              : qs.map(() => ({ kind: 'counts' as const, counts: {} as never, total: version })),
        };
      }),
    };
    const src = new LiveWidgetSource(port, { hidden: () => false });
    const seen = vi.fn();
    src.register({ kind: 'counts' }, seen);
    src.register({ kind: 'counts', fleetId: 'f1' }, () => {});
    await src.poll();
    expect(calls).toEqual([[2, undefined]]);
    expect(seen).toHaveBeenCalledTimes(1);
    await src.poll();
    expect(calls[1]).toEqual([2, 1]);
    expect(seen).toHaveBeenCalledTimes(1);
    version = 2;
    await src.poll();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(src.get(JSON.stringify({ kind: 'counts' })).result).toMatchObject({ total: 2 });
    const off = new LiveWidgetSource({ ...port, running: false }, { hidden: () => false });
    off.register({ kind: 'counts' }, () => {});
    await off.poll();
    expect(off.get(JSON.stringify({ kind: 'counts' })).status).toBe('unavailable');
    src.dispose();
    off.dispose();
  });
});
