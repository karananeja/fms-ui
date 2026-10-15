import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EllipsisVertical, GripVertical, PencilLine, RotateCw, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { WIDGET_TITLE_MAX, type Widget } from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';
import { formatUpdated } from '../lib/format';
import {
  RANGE_SHORT,
  RANGE_TEXT,
  widgetRange,
  widgetSource,
  widgetTypeInfo,
} from '../lib/widget-meta';
import { WidgetErrorBoundary } from './widget-states';

const menuItem =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none data-[highlighted]:bg-tile data-[highlighted]:text-accent [&_svg]:size-4';

/**
 * §6.1: a widget's frame: header (drag handle for owners ≥ md, title, live dot, menu) and the
 * body inside an error boundary. Owners get Edit title / Remove; everyone gets Refresh.
 */
export function WidgetFrame({
  widget,
  owner,
  draggable,
  live,
  grabbed,
  onHandleKeyDown,
  onRefresh,
  onRename,
  onRemove,
  refreshedAt = null,
  children,
}: {
  widget: Widget;
  owner: boolean;
  draggable: boolean;
  live: boolean;
  /** F23: when the REST data last arrived (`null`: live, a note, or not loaded yet). */
  refreshedAt?: number | null;
  grabbed: boolean;
  onHandleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  onRefresh(): void;
  onRename(title: string): void;
  onRemove(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  const source = widgetSource(widget);
  const range = widgetRange(widget);
  const TypeIcon = widgetTypeInfo(widget.type).icon;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(widget.title);

  const save = () => {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== widget.title) onRename(t.slice(0, WIDGET_TITLE_MAX));
  };

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      data-testid="widget"
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      className={cn(
        'widget-enter @container flex h-full flex-col overflow-hidden rounded-[var(--radius-tile)] shadow-panel glass',
        grabbed && 'ring-2 ring-ring',
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-glass-border/60 pr-1 pl-2">
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5',
            draggable && 'widget-drag-handle cursor-grab active:cursor-grabbing',
          )}
        >
          {draggable && (
            <button
              type="button"
              aria-label={`Move ${widget.title}`}
              aria-pressed={grabbed}
              aria-describedby="dashboard-arrange-help"
              data-testid="widget-handle"
              onKeyDown={onHandleKeyDown}
              className="grid size-8 shrink-0 place-items-center rounded-md text-text-faint outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GripVertical aria-hidden className="size-4" />
            </button>
          )}
          {editing ? (
            <input
              autoFocus
              aria-label="Widget title"
              value={draft}
              maxLength={WIDGET_TITLE_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                else if (e.key === 'Escape') {
                  setDraft(widget.title);
                  setEditing(false);
                }
              }}
              className="widget-no-drag h-7 min-w-0 flex-1 rounded-md border border-tile-border bg-tile px-2 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <h3
              id={titleId}
              title={widget.title}
              data-testid="widget-title"
              className={cn('min-w-0 truncate text-[13px] font-semibold', !draggable && 'pl-1')}
            >
              {widget.title}
            </h3>
          )}
          {live && (
            <span
              title="Live: updates every second"
              data-testid="live-dot"
              className="size-1.5 shrink-0 rounded-full bg-ok"
            >
              <span className="sr-only">Live</span>
            </span>
          )}
          {/* F23: source chip and last refresh (hidden when the tile is narrow). */}
          <span
            data-testid="widget-source"
            title={`Source: ${source}${range ? ` · ${RANGE_TEXT[range]}` : ''}`}
            className="hidden shrink-0 items-center gap-1 rounded-full bg-tile px-1.5 py-0.5 text-[10px] font-semibold text-text-muted @[16rem]:inline-flex"
          >
            <TypeIcon aria-hidden className="size-3" />
            {source}
            {range && <span className="text-text-faint">· {RANGE_SHORT[range]}</span>}
          </span>
        </div>
        {refreshedAt !== null && refreshedAt > 0 && (
          <span
            data-testid="widget-refreshed"
            title={`Last refreshed ${formatUpdated(refreshedAt, refreshedAt)}`}
            className="hidden shrink-0 text-[10px] text-text-faint tabular-nums @[20rem]:inline"
          >
            {formatUpdated(refreshedAt, refreshedAt).replace(' IST', '')}
          </span>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={`Actions for ${widget.title}`}
            data-testid="widget-menu"
            className="widget-no-drag grid size-8 shrink-0 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-tile"
          >
            <EllipsisVertical aria-hidden className="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 w-44 rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-float"
            >
              <DropdownMenu.Item className={menuItem} onSelect={onRefresh}>
                <RotateCw aria-hidden />
                Refresh
              </DropdownMenu.Item>
              {owner && (
                <>
                  <DropdownMenu.Item
                    className={menuItem}
                    onSelect={() => {
                      setDraft(widget.title);
                      setEditing(true);
                    }}
                  >
                    <PencilLine aria-hidden />
                    Edit title
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={cn(menuItem, 'text-danger')} onSelect={onRemove}>
                    <Trash2 aria-hidden />
                    Remove
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      <div className="relative min-h-0 flex-1 p-3">
        <WidgetErrorBoundary resetKey={JSON.stringify(widget)}>{children}</WidgetErrorBoundary>
      </div>
    </section>
  );
}
