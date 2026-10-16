import {
  BREAKPOINT_IDS,
  DASHBOARD_BREAKPOINTS,
  WIDGET_SIZES,
  type DashboardLayout,
  type LayoutItem,
  type Widget,
} from '../contract/dashboards.ts';

/**
 * D-162: dashboard auto-layout. `firstFit` puts a new widget in the first free gap (top-left
 * first) instead of below everything; `packLayout` ("Organise") re-packs a whole dashboard:
 * small tiles first, then charts, then tables / lists / maps, each row stretched edge to edge.
 */

type PackWidget = Pick<Widget, 'id' | 'type'> & { spec?: { mark?: { type?: string } } };

const SMALL_MARKS = new Set(['number', 'gauge']);
const CHART_MARKS = new Set(['bar', 'line', 'area', 'pie', 'donut', 'heatmap', 'instrument']);

/** 0 = small tiles (KPIs, numbers, notes), 1 = charts, 2 = tables, lists and maps. */
export function widgetRank(w: PackWidget): 0 | 1 | 2 {
  if (w.type === 'kpi' || w.type === 'text') return 0;
  if (w.type === 'daily-chart' || w.type === 'status-breakdown') return 1;
  if (w.type === 'custom') {
    const mark = w.spec?.mark?.type ?? '';
    if (SMALL_MARKS.has(mark)) return 0;
    if (CHART_MARKS.has(mark)) return 1;
  }
  return 2;
}

const overlaps = (a: Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>, b: LayoutItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The top-most, then left-most spot where a `w × h` tile fits among `items`. */
export function firstFit(items: readonly LayoutItem[], w: number, h: number, cols: number) {
  const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const width = Math.min(w, cols);
  for (let y = 0; y <= bottom; y++)
    for (let x = 0; x + width <= cols; x++)
      if (!items.some((it) => overlaps({ x, y, w: width, h }, it))) return { x, y };
  return { x: 0, y: bottom };
}

/** Re-packs every breakpoint (keeps chart / list heights and, where they fit, widths). */
export function packLayout(widgets: readonly PackWidget[], layout?: Partial<DashboardLayout>): DashboardLayout {
  const out = { lg: [], md: [], sm: [] } as DashboardLayout;
  for (const bp of BREAKPOINT_IDS) {
    const { cols } = DASHBOARD_BREAKPOINTS[bp];
    const current = new Map((layout?.[bp] ?? []).map((l) => [l.i, l]));
    const order = widgets
      .map((w, k) => ({ w, k, cur: current.get(w.id) }))
      .sort(
        (a, b) =>
          widgetRank(a.w) - widgetRank(b.w) ||
          (a.cur?.y ?? Infinity) - (b.cur?.y ?? Infinity) ||
          (a.cur?.x ?? 0) - (b.cur?.x ?? 0) ||
          a.k - b.k,
      );
    const items: LayoutItem[] = [];
    let y = 0;
    let row: { w: PackWidget; width: number; h: number; minW: number; minH: number }[] = [];
    let used = 0;
    let rank = -1;
    const flush = () => {
      if (!row.length) return;
      // Stretch the row to the full width: spread the spare columns left to right.
      const spare = cols - used;
      let x = 0;
      row.forEach((r, n) => {
        const width = r.width + Math.floor(spare / row.length) + (n < spare % row.length ? 1 : 0);
        items.push({ i: r.w.id, x, y, w: width, h: r.h, minW: r.minW, minH: r.minH });
        x += width;
      });
      y += Math.max(...row.map((r) => r.h));
      row = [];
      used = 0;
    };
    for (const { w, cur } of order) {
      const size = WIDGET_SIZES[w.type];
      const minW = Math.min(size.minW, cols);
      const width = bp === 'sm' ? 1 : Math.max(minW, Math.min(cur?.w ?? size.w, cols));
      const r = widgetRank(w);
      if (r !== rank || used + width > cols) flush();
      rank = r;
      // Small tiles get their standard height; charts and lists keep a height the user chose.
      const h = r === 0 ? size.h : (cur?.h ?? size.h);
      row.push({ w, width, h, minW, minH: size.minH });
      used += width;
    }
    flush();
    out[bp] = items;
  }
  return out;
}
