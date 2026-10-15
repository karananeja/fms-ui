// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createDashboardBodySchema,
  dashboardContentSchema,
  updateDashboardBodySchema,
  widgetSchema,
  WIDGET_TYPES,
  widgetPermission,
  type Widget,
} from './dashboards.ts';

const SAMPLE_WIDGETS: Widget[] = [
  {
    id: 'w-kpi',
    type: 'kpi',
    title: 'Distance',
    source: 'analytics',
    metric: 'distanceKm',
    range: '7d',
  },
  {
    id: 'w-live',
    type: 'kpi',
    title: 'Running',
    source: 'live',
    status: 'running',
    fleetId: 'f-1',
  },
  {
    id: 'w-chart',
    type: 'daily-chart',
    title: 'Idle',
    chart: 'area',
    metrics: ['idleMs'],
    range: '30d',
  },
  { id: 'w-status', type: 'status-breakdown', title: 'Status', display: 'donut' },
  {
    id: 'w-rank',
    type: 'ranking',
    title: 'Top drivers',
    entity: 'drivers',
    metric: 'score',
    order: 'desc',
    limit: 10,
    range: 'today',
  },
  {
    id: 'w-vl',
    type: 'vehicle-list',
    title: 'Low SoC',
    filter: { statuses: ['stopped'], socMax: 20 },
    columns: ['regno', 'soc'],
    sort: { column: 'soc', dir: 'asc' },
    limit: 20,
  },
  { id: 'w-dl', type: 'driver-list', title: 'Drivers', status: 'active', limit: 5 },
  {
    id: 'w-rq',
    type: 'requests-summary',
    title: 'Open breakdowns',
    groupBy: 'status',
    types: ['breakdown'],
    openOnly: true,
    display: 'counts',
    limit: 50,
  },
  { id: 'w-text', type: 'text', title: 'Notes', body: '**Hello**' },
];

const pathsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('F18-T1: widget catalogue and layout validation', () => {
  it('every widget type parses with valid settings', () => {
    for (const w of SAMPLE_WIDGETS) expect(widgetSchema.safeParse(w).success, w.type).toBe(true);
    expect(new Set(SAMPLE_WIDGETS.map((w) => w.type))).toEqual(new Set(WIDGET_TYPES));
    expect(widgetPermission(SAMPLE_WIDGETS[1]!)).toBe('live.view');
    expect(widgetPermission(SAMPLE_WIDGETS[0]!)).toBe('analytics.view');
    expect(widgetPermission(SAMPLE_WIDGETS[8]!)).toBeNull();
  });

  it('rejects unknown types, unknown keys and out-of-range settings', () => {
    const bad: unknown[] = [
      { id: 'w-x', type: 'iframe', title: 'x', src: 'https://evil' },
      { id: 'w-x', type: 'text', title: 'x', body: 'hi', html: '<b>hi</b>' },
      { ...SAMPLE_WIDGETS[4], entity: 'vehicles' }, // score is drivers-only
      { ...SAMPLE_WIDGETS[4], limit: 51 },
      { ...SAMPLE_WIDGETS[0], range: '2d' },
      { ...SAMPLE_WIDGETS[2], range: 'today' }, // daily charts need ≥ 7d
      { ...SAMPLE_WIDGETS[8], body: 'x'.repeat(2001) },
      { ...SAMPLE_WIDGETS[8], title: 'x'.repeat(61) },
      { ...SAMPLE_WIDGETS[8], id: 'W_bad' },
      { ...SAMPLE_WIDGETS[1], metric: 'distanceKm' }, // live kpi has no metric
    ];
    for (const w of bad) expect(widgetSchema.safeParse(w).success, JSON.stringify(w)).toBe(false);
    expect(
      pathsOf(createDashboardBodySchema.safeParse({ widgets: [{ type: 'iframe', title: 'x' }] })),
    ).toContain('widgets.0.type');
  });

  it('caps widgets at 24 and dashboard titles at 80', () => {
    const many = Array.from({ length: 25 }, (_, n) => ({ ...SAMPLE_WIDGETS[8]!, id: `w-${n}` }));
    expect(createDashboardBodySchema.safeParse({ widgets: many }).success).toBe(false);
    expect(createDashboardBodySchema.safeParse({ widgets: many.slice(0, 24) }).success).toBe(true);
    expect(createDashboardBodySchema.safeParse({ title: 'x'.repeat(81) }).success).toBe(false);
    expect(createDashboardBodySchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(updateDashboardBodySchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('layout rules: x + w ≤ cols, unique i, i references a widget, minW/minH', () => {
    const widgets = [SAMPLE_WIDGETS[0]!, SAMPLE_WIDGETS[8]!];
    const item = (i: string, x = 0, w = 3) => ({ i, x, y: 0, w, h: 2 });
    const content = (lg: object[], md: object[] = [], sm: object[] = []) =>
      dashboardContentSchema.safeParse({
        title: 'T',
        description: '',
        widgets,
        layout: { lg, md, sm },
      });
    expect(
      content([item('w-kpi'), item('w-text', 3)], [item('w-kpi', 3)], [item('w-text', 0, 1)])
        .success,
    ).toBe(true);
    expect(pathsOf(content([item('w-kpi', 10, 3)]))).toContain('layout.lg.0.w');
    expect(pathsOf(content([], [item('w-kpi', 4, 3)]))).toContain('layout.md.0.w');
    expect(pathsOf(content([], [], [item('w-kpi', 0, 2)]))).toContain('layout.sm.0.w');
    expect(pathsOf(content([item('w-kpi'), item('w-kpi', 3)]))).toContain('layout.lg.1.i');
    expect(pathsOf(content([item('w-nope')]))).toContain('layout.lg.0.i');
    expect(pathsOf(content([{ ...item('w-kpi'), minW: 4 }]))).toContain('layout.lg.0.w');
    expect(content([{ ...item('w-kpi'), h: 25 }]).success).toBe(false);
    expect(content([{ ...item('w-kpi'), extra: 1 }]).success).toBe(false);
  });
});
