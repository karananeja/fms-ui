import {
  BREAKPOINT_IDS,
  DASHBOARD_BREAKPOINTS,
  LAYOUT_ROW_MAX,
  WIDGET_SIZES,
  type DashboardBreakpoint,
  type DashboardLayout,
  type LayoutItem,
  type Widget,
} from '@shared/contract/dashboards.ts';

/**
 * D-128 / §17 Q2: the breakpoint follows the grid **container** width. `lg` starts at 940 px so a
 * 1440 px window with the 64 px rail, the 360 px chat dock and the page padding (≈ 984 px of grid)
 * keeps the 12-column layout; `md` from 600 px; phones are `sm`. Columns come from the contract.
 */
export const GRID_BREAKPOINTS: Record<DashboardBreakpoint, number> = { lg: 940, md: 600, sm: 0 };
export const GRID_COLS = Object.fromEntries(
  BREAKPOINT_IDS.map((bp) => [bp, DASHBOARD_BREAKPOINTS[bp].cols]),
) as Record<DashboardBreakpoint, number>;
export const ROW_HEIGHT = 72;
export const GRID_MARGIN = [12, 12] as const;

export const breakpointFor = (width: number): DashboardBreakpoint =>
  width >= GRID_BREAKPOINTS.lg ? 'lg' : width >= GRID_BREAKPOINTS.md ? 'md' : 'sm';

/** Any RGL item shape (extra fields such as `moved`/`static` are dropped). */
export type LooseItem = Pick<LayoutItem, 'i' | 'x' | 'y' | 'w' | 'h'> & {
  minW?: number;
  minH?: number;
};

/** Minimum size of a widget on a breakpoint (stored item first, else `WIDGET_SIZES` scaled). */
export function minSize(
  type: Widget['type'],
  bp: DashboardBreakpoint,
  item?: Partial<LooseItem>,
): { minW: number; minH: number } {
  const cols = GRID_COLS[bp];
  const s = WIDGET_SIZES[type];
  const minW = item?.minW ?? (bp === 'lg' ? s.minW : bp === 'md' ? Math.ceil(s.minW / 2) : 1);
  return { minW: Math.max(1, Math.min(minW, cols)), minH: item?.minH ?? s.minH };
}

/** `{i,x,y,w,h,minW?,minH?}` only, integers, `x + w ≤ cols`, `w ≥ minW`, `h` in range. */
export function sanitizeItems(items: readonly LooseItem[], bp: DashboardBreakpoint): LayoutItem[] {
  const cols = GRID_COLS[bp];
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const it of items) {
    if (seen.has(it.i)) continue;
    seen.add(it.i);
    const minW =
      it.minW === undefined ? undefined : Math.max(1, Math.min(cols, Math.round(it.minW)));
    const minH =
      it.minH === undefined
        ? undefined
        : Math.max(1, Math.min(LAYOUT_ROW_MAX, Math.round(it.minH)));
    const w = Math.max(minW ?? 1, Math.min(cols, Math.round(it.w)));
    const h = Math.max(minH ?? 1, Math.min(LAYOUT_ROW_MAX, Math.round(it.h)));
    const x = Math.max(0, Math.min(cols - w, Math.round(it.x)));
    const y = Math.max(0, Math.round(it.y));
    out.push({
      i: it.i,
      x,
      y,
      w,
      h,
      ...(minW !== undefined && { minW }),
      ...(minH !== undefined && { minH }),
    });
  }
  return out;
}

export function sanitizeLayout(
  layouts: Partial<Record<DashboardBreakpoint, readonly LooseItem[]>>,
): DashboardLayout {
  return {
    lg: sanitizeItems(layouts.lg ?? [], 'lg'),
    md: sanitizeItems(layouts.md ?? [], 'md'),
    sm: sanitizeItems(layouts.sm ?? [], 'sm'),
  };
}

/**
 * §8 rebase: the user's pending positions re-applied on top of a newer server layout, for widgets
 * that still exist; new widgets keep the server's positions.
 */
export function rebaseLayout(
  pending: DashboardLayout,
  server: DashboardLayout,
  widgetIds: readonly string[],
): DashboardLayout {
  const ids = new Set(widgetIds);
  const out = {} as DashboardLayout;
  for (const bp of BREAKPOINT_IDS) {
    const mine = new Map(pending[bp].filter((it) => ids.has(it.i)).map((it) => [it.i, it]));
    out[bp] = server[bp].filter((it) => ids.has(it.i)).map((it) => mine.get(it.i) ?? it);
  }
  return out;
}

export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- keyboard move / resize (D-133) ----

export type ArrangeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
const DELTA: Record<ArrangeKey, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** One keyboard step: arrows move by a cell, `resize` (Shift) grows/shrinks; clamped to the grid. */
export function arrangeStep(
  items: readonly LayoutItem[],
  id: string,
  key: ArrangeKey,
  resize: boolean,
  bp: DashboardBreakpoint,
): LayoutItem[] {
  const cols = GRID_COLS[bp];
  const [dx, dy] = DELTA[key];
  return items.map((it) => {
    if (it.i !== id) return it;
    if (resize) {
      const w = Math.max(it.minW ?? 1, Math.min(cols - it.x, it.w + dx));
      const h = Math.max(it.minH ?? 1, Math.min(LAYOUT_ROW_MAX, it.h + dy));
      return { ...it, w, h };
    }
    return {
      ...it,
      x: Math.max(0, Math.min(cols - it.w, it.x + dx)),
      y: Math.max(0, it.y + dy),
    };
  });
}

export const describeItem = (it: LayoutItem, resize: boolean) =>
  resize ? `Resized to ${it.w} by ${it.h}` : `Moved to column ${it.x + 1}, row ${it.y + 1}`;
