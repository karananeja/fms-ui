// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dashboardContentSchema, TIME_RANGES, widgetPermission, widgetSchema } from './dashboards.ts';
import { CUSTOM_RANGES, customSpecSchema, type CustomSpec } from './widget-grammar.ts';

const messages = (spec: unknown) => {
  const r = customSpecSchema.safeParse(spec);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

const MAP: CustomSpec = {
  data: { dataset: 'live-vehicles', filter: { all: [{ field: 'soc', op: 'lt', value: 20 }] } },
  mark: { type: 'map', color: 'status', cluster: true },
};

describe('F26-T1 widget grammar validation', () => {
  it('accepts the documented shapes', () => {
    const ok: CustomSpec[] = [
      MAP,
      {
        data: { dataset: 'live-vehicles', filter: { all: [{ field: 'regno', op: 'eq', value: 'MH12AB1234' }] } },
        mark: { type: 'map', follow: true, trailMinutes: 30 },
      },
      {
        data: { dataset: 'analytics-ranking', range: '7d' },
        shape: { groupBy: 'fleet', aggregate: { op: 'sum', field: 'breakdowns' }, limit: 10 },
        mark: { type: 'bar' },
      },
      {
        data: { dataset: 'live-vehicles' },
        shape: { sort: { by: 'speed', dir: 'desc' }, limit: 10 },
        mark: { type: 'table', columns: ['regno', 'speed'] },
      },
      { data: { dataset: 'requests', range: '30d' }, shape: { groupBy: 'type', timeBucket: 'day' }, mark: { type: 'heatmap' } },
      { data: { dataset: 'analytics-series' }, mark: { type: 'line', x: 'day', y: 'distanceKm' } },
      { data: { dataset: 'live-vehicles' }, shape: { aggregate: { op: 'avg', field: 'soc' } }, mark: { type: 'gauge' } },
      { data: { dataset: 'vehicle-history', vehicle: 'MH12AB1234', minutes: 120 }, mark: { type: 'map' } },
      { data: { dataset: 'analytics-ranking', entity: 'drivers' }, shape: { sort: { by: 'score', dir: 'asc' } }, mark: { type: 'table', columns: ['name', 'score'] } },
    ];
    for (const s of ok) expect(messages(s), JSON.stringify(s)).toEqual([]);
  });

  it('rejects unknown fields, bad ops / values and mark mismatches with fixable messages', () => {
    expect(messages({ ...MAP, data: { dataset: 'live-vehicles', filter: { all: [{ field: 'battery', op: 'lt', value: 20 }] } } })[0]).toMatch(
      /Unknown field "battery" for live-vehicles\. Use one of: .*soc/,
    );
    expect(messages({ data: { dataset: 'live-vehicles', filter: { all: [{ field: 'regno', op: 'lt', value: 'x' }] } }, mark: { type: 'number' } })[0]).toMatch(
      /Op "lt" does not apply to string field "regno"/,
    );
    expect(messages({ data: { dataset: 'live-vehicles', filter: { all: [{ field: 'status', op: 'eq', value: 'flying' }] } }, mark: { type: 'number' } })[0]).toMatch(
      /"flying" is not a status/,
    );
    expect(messages({ data: { dataset: 'live-vehicles', filter: { all: [{ field: 'soc', op: 'in', value: 5 }] } }, mark: { type: 'number' } })[0]).toMatch(/needs a list/);
    expect(messages({ data: { dataset: 'live-vehicles' }, shape: { groupBy: 'speed' }, mark: { type: 'bar' } })[0]).toMatch(/Group by a text/);
    expect(messages({ data: { dataset: 'requests' }, shape: { groupBy: 'type' }, mark: { type: 'line' } })[0]).toMatch(/add shape.timeBucket/);
    expect(messages({ data: { dataset: 'requests' }, shape: { groupBy: 'type' }, mark: { type: 'number' } })[0]).toMatch(/shows one value/);
    expect(messages({ data: { dataset: 'requests' }, mark: { type: 'map' } })[0]).toMatch(/Map marks need dataset live-vehicles/);
    expect(messages({ data: { dataset: 'live-vehicles' }, mark: { type: 'map', follow: true } })[0]).toMatch(/Ask the user which vehicle/);
    expect(messages({ data: { dataset: 'live-vehicles' }, mark: { type: 'table' } })[0]).toMatch(/needs mark.columns/);
    expect(messages({ data: { dataset: 'live-vehicles', minutes: 30 }, mark: { type: 'number' } })[0]).toMatch(/data.minutes is not used/);
    expect(messages({ data: { dataset: 'analytics-ranking' }, shape: { aggregate: { op: 'sum', field: 'regno' } }, mark: { type: 'number' } })[0]).toMatch(/needs a number field/);
    expect(messages({ data: { dataset: 'analytics-ranking' }, mark: { type: 'table', columns: ['name'] } })[0]).toMatch(/Unknown field "name"/);
    // zod shape: limits and unknown keys.
    expect(messages({ data: { dataset: 'live-vehicles' }, shape: { limit: 500 }, mark: { type: 'table', columns: ['regno'] } }).length).toBe(1);
    expect(messages({ ...MAP, code: 'alert(1)' }).length).toBe(1);
    expect(messages({ data: { dataset: 'sql' }, mark: { type: 'number' } }).length).toBeGreaterThan(0);
  });

  it('permission per dataset, ranges in sync, at most 3 maps per dashboard', () => {
    expect(CUSTOM_RANGES).toEqual(TIME_RANGES);
    const w = (k: number, spec: CustomSpec) => ({ id: `w-m${k}`, type: 'custom' as const, title: `Map ${k}`, spec });
    expect(widgetPermission(w(0, MAP))).toBe('live.view');
    expect(widgetPermission(w(0, { data: { dataset: 'notifications' }, shape: { groupBy: 'kind' }, mark: { type: 'pie' } }))).toBeNull();
    expect(widgetPermission(w(0, { data: { dataset: 'requests' }, shape: { groupBy: 'type' }, mark: { type: 'pie' } }))).toBe('requests.manage');
    expect(widgetSchema.safeParse(w(0, MAP)).success).toBe(true);
    const content = (n: number) => ({
      title: 'Maps',
      description: '',
      widgets: Array.from({ length: n }, (_, k) => w(k, MAP)),
      layout: { lg: [], md: [], sm: [] },
    });
    expect(dashboardContentSchema.safeParse(content(3)).success).toBe(true);
    const four = dashboardContentSchema.safeParse(content(4));
    expect(four.success).toBe(false);
    expect(four.error?.issues[0]?.message).toMatch(/At most 3 map widgets/);
  });
});
