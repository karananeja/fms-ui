// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../contract/dashboards.ts';
import { firstFit, packLayout, widgetRank } from './dashboard-pack.ts';

const item = (i: string, x: number, y: number, w: number, h: number): LayoutItem => ({ i, x, y, w, h });

describe('D-162 dashboard auto-layout', () => {
  it('firstFit fills the first gap, top-left first', () => {
    // A 6-wide chart on the left leaves a 6-wide gap on the right of the top row.
    expect(firstFit([item('a', 0, 0, 6, 4)], 3, 2, 12)).toEqual({ x: 6, y: 0 });
    expect(firstFit([item('a', 0, 0, 12, 4)], 3, 2, 12)).toEqual({ x: 0, y: 4 });
    expect(firstFit([], 6, 4, 12)).toEqual({ x: 0, y: 0 });
  });

  it('ranks tiles, charts and lists; packs rows edge to edge, one rank per row', () => {
    const w = [
      { id: 'list', type: 'vehicle-list' as const },
      { id: 'k1', type: 'kpi' as const },
      { id: 'chart', type: 'daily-chart' as const },
      { id: 'k2', type: 'kpi' as const },
      { id: 'inst', type: 'custom' as const, spec: { mark: { type: 'instrument' } } },
      { id: 'num', type: 'custom' as const, spec: { mark: { type: 'number' } } },
    ];
    expect(w.map(widgetRank)).toEqual([2, 0, 1, 0, 1, 0]);
    const lg = packLayout(w).lg;
    const at = (id: string) => lg.find((l) => l.i === id)!;
    // Row 1: three small tiles fill 12 columns; row 2: chart + instrument; row 3: the list.
    expect([at('k1'), at('k2'), at('num')].map((l) => l.y)).toEqual([0, 0, 0]);
    expect(at('k1').w + at('k2').w + at('num').w).toBe(12);
    // The tile row is as tall as its tallest tile (a custom number tile is 5 rows).
    expect(at('chart').y).toBe(Math.max(at('k1').h, at('num').h));
    expect(at('chart').w + at('inst').w).toBe(12);
    expect(at('list')).toMatchObject({ x: 0, w: 12 });
    expect(at('list').y).toBeGreaterThan(at('chart').y);
    // sm is one column in rank order.
    expect(packLayout(w).sm.map((l) => l.i)).toEqual(['k1', 'k2', 'num', 'chart', 'inst', 'list']);
  });

  it('keeps heights (and widths where they fit) from the current layout', () => {
    const w = [{ id: 'chart', type: 'daily-chart' as const }];
    const lg = packLayout(w, { lg: [item('chart', 4, 9, 8, 7)] }).lg;
    expect(lg).toEqual([expect.objectContaining({ i: 'chart', x: 0, y: 0, w: 12, h: 7 })]);
  });
});
