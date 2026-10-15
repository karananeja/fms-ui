import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Responsive, useContainerWidth, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import './dashboard-grid.css';
import {
  BREAKPOINT_IDS,
  type Dashboard,
  type DashboardBreakpoint,
  type DashboardLayout,
  type LayoutItem,
  type Widget,
  type WidgetPreview,
} from '@shared/contract/dashboards.ts';
import { useWidgetData } from '../data/use-widget-data';
import { widgetRequest } from '../data/widget-queries';
import {
  breakpointFor,
  GRID_BREAKPOINTS,
  GRID_COLS,
  GRID_MARGIN,
  minSize,
  ROW_HEIGHT,
  sanitizeItems,
  type LooseItem,
} from '../lib/layout';
import { draggedPreview, droppedPreview } from '../lib/preview-drag';
import type { AddAt } from '../store/dashboard-session';
import { useWidgetAllowed } from '../widgets/widget-data';
import { isLiveWidget, WidgetRenderer } from '../widgets/widget-renderer';
import { useKeyboardArrange } from './keyboard-arrange';
import { WidgetFrame } from './widget-frame';

/**
 * D-127 / D-128: the only react-grid-layout importer (lazy `/dashboards/$id` chunk). The breakpoint
 * follows the container width; owners drag/resize at `md`/`lg` only; a save is scheduled only
 * from a drag/resize stop or a keyboard drop, never on mount or a breakpoint change.
 */
export function DashboardGrid({
  dashboard,
  owner,
  onLayout,
  onWidgetRefresh,
  onWidgetRename,
  onWidgetRemove,
  onDropPreview,
}: {
  dashboard: Dashboard;
  /** D-135: a chat preview card dropped on the grid (owners at md/lg). */
  onDropPreview?(preview: WidgetPreview, at: AddAt): void;
  owner: boolean;
  onLayout(layout: DashboardLayout): void;
  onWidgetRefresh(w: Widget): void;
  onWidgetRename(id: string, title: string): void;
  onWidgetRemove(id: string): void;
}) {
  const { width, mounted, containerRef } = useContainerWidth();
  const bp = breakpointFor(width);
  const editable = owner && bp !== 'sm';
  const byId = useMemo(() => new Map(dashboard.widgets.map((w) => [w.id, w])), [dashboard.widgets]);

  const commit = (bpItems: readonly LooseItem[]) =>
    onLayout({ ...dashboard.layout, [bp]: sanitizeItems(bpItems, bp) });
  const arrange = useKeyboardArrange({
    items: dashboard.layout[bp],
    bp,
    onCommit: (items) => commit(items),
  });

  const layouts = useMemo(() => {
    const out = {} as Record<DashboardBreakpoint, LayoutItem[]>;
    for (const b of BREAKPOINT_IDS) {
      const items = b === bp && arrange.working ? arrange.working : dashboard.layout[b];
      out[b] = items
        .filter((it) => byId.has(it.i))
        .map((it) => ({
          ...it,
          ...minSize(byId.get(it.i)!.type, b, it),
          ...(b === 'sm' && { h: Math.max(2, it.h) }),
          static: !owner || b === 'sm',
        }));
    }
    return out;
  }, [dashboard.layout, byId, bp, arrange.working, owner]);

  const auto = useEdgeAutoScroll(containerRef);
  const stop = (layout: Layout) => {
    auto.end();
    commit(layout as readonly LooseItem[]);
  };

  // D-135: the placeholder takes the preview's default size (clamped to the breakpoint).
  const sizeOn = (p: WidgetPreview) => ({
    w: Math.min(p.size.w, GRID_COLS[bp]),
    h: p.size.h,
  });
  const droppable = editable && !!onDropPreview;
  const dropConfig = {
    enabled: droppable,
    defaultItem: { w: 3, h: 2 },
    onDragOver: (e: DragEvent) => {
      const p = draggedPreview(e.dataTransfer);
      if (!p) return false as const;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      return sizeOn(p);
    },
  };
  const drop = (layout: Layout, item: LooseItem | undefined, e: Event) => {
    const p = droppedPreview((e as DragEvent).dataTransfer ?? null);
    if (!p || !item || !onDropPreview) return;
    const items = (layout as readonly LooseItem[]).map((it) =>
      it.i === item.i ? { ...it, i: p.widget.id, ...sizeOn(p), ...minSize(p.widget.type, bp) } : it,
    );
    onDropPreview(p, { bp, items: items.filter((it) => it.i === p.widget.id || byId.has(it.i)) });
  };

  return (
    <div
      ref={containerRef}
      className="dashboard-grid w-full"
      data-testid="dashboard-grid"
      data-breakpoint={bp}
    >
      <p id="dashboard-arrange-help" className="sr-only">
        Press Space to pick up the widget, arrow keys to move it, Shift and arrow keys to resize,
        Space to drop or Escape to cancel.
      </p>
      <p aria-live="polite" className="sr-only" data-testid="arrange-status">
        {arrange.message}
      </p>
      {mounted && (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLS}
          rowHeight={ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={[0, 0]}
          dragConfig={{
            enabled: editable,
            handle: '.widget-drag-handle',
            cancel: '.widget-no-drag',
          }}
          resizeConfig={{ enabled: editable, handles: ['se'] }}
          onDrag={auto.move}
          onResize={auto.move}
          onDragStop={stop}
          onResizeStop={stop}
          dropConfig={dropConfig}
          onDrop={drop}
        >
          {dashboard.widgets.map((w) => (
            <div key={w.id}>
              <GridCell
                widget={w}
                owner={owner}
                draggable={editable}
                grabbed={arrange.grabbedId === w.id}
                onHandleKeyDown={arrange.keyHandler(w.id, w.title)}
                onRefresh={() => onWidgetRefresh(w)}
                onRename={(t) => onWidgetRename(w.id, t)}
                onRemove={() => onWidgetRemove(w.id)}
              />
            </div>
          ))}
        </Responsive>
      )}
    </div>
  );
}

const EDGE_PX = 56;
const EDGE_SPEED = 18;

/**
 * F23 scroll fix: while a widget is dragged or resized near the top/bottom edge of the grid's
 * scroll area, scroll it (pointer drags don't auto-scroll a nested scroller on their own).
 */
function useEdgeAutoScroll(containerRef: RefObject<HTMLElement | null>) {
  const s = useRef<{ y: number; raf: number | null }>({ y: -1, raf: null });
  const scroller = () => {
    let el = containerRef.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    return el;
  };
  const end = () => {
    if (s.current.raf !== null) cancelAnimationFrame(s.current.raf);
    s.current = { y: -1, raf: null };
  };
  const tick = () => {
    const el = scroller();
    if (!el || s.current.y < 0) return end();
    const r = el.getBoundingClientRect();
    const y = s.current.y;
    const dy = y > r.bottom - EDGE_PX ? EDGE_SPEED : y < r.top + EDGE_PX ? -EDGE_SPEED : 0;
    if (dy) el.scrollBy(0, dy);
    s.current.raf = requestAnimationFrame(tick);
  };
  const move = (...args: unknown[]) => {
    const e = args[4] as MouseEvent | TouchEvent | undefined;
    const y = e && 'touches' in e ? (e.touches[0]?.clientY ?? -1) : ((e as MouseEvent)?.clientY ?? -1);
    s.current.y = y;
    if (s.current.raf === null && y >= 0) s.current.raf = requestAnimationFrame(tick);
  };
  return { move, end };
}

function GridCell(
  props: Omit<Parameters<typeof WidgetFrame>[0], 'children' | 'live' | 'refreshedAt'>,
): ReactNode {
  // F23: the same cache entry the renderer reads (no extra request); null for live widgets.
  const allowed = useWidgetAllowed(props.widget);
  const { fetchedAt } = useWidgetData(allowed ? widgetRequest(props.widget) : null);
  return (
    <WidgetFrame {...props} live={isLiveWidget(props.widget)} refreshedAt={fetchedAt || null}>
      <WidgetRenderer widget={props.widget} />
    </WidgetFrame>
  );
}
