import { useMemo, type ReactNode } from 'react';
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
} from '@shared/contract/dashboards.ts';
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
}: {
  dashboard: Dashboard;
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

  const stop = (layout: Layout) => commit(layout as readonly LooseItem[]);

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
          onDragStop={stop}
          onResizeStop={stop}
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

function GridCell(props: Omit<Parameters<typeof WidgetFrame>[0], 'children' | 'live'>): ReactNode {
  return (
    <WidgetFrame {...props} live={isLiveWidget(props.widget)}>
      <WidgetRenderer widget={props.widget} />
    </WidgetFrame>
  );
}
