import { lazy, Suspense, useState, type ReactNode } from 'react';
import { GripVertical, MessageSquareText, Plus, X } from 'lucide-react';
import type { WidgetPreview } from '@shared/contract/dashboards.ts';
import { endPreviewDrag, startPreviewDrag } from '@/features/dashboards/lib/preview-drag';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

// The renderer chunk loads with the first preview (never react-grid-layout).
const PreviewWidgetBody = lazy(
  () => import('@/features/dashboards/components/preview-widget-body.tsx'),
);

/** Chat-friendly body height for the widget's default size (rows). */
export const previewHeight = (rows: number) => Math.min(260, Math.max(112, rows * 56));

export const askToChangeText = (p: WidgetPreview) => `Change the "${p.widget.title}" preview: `;

/**
 * D-135: a widget the assistant proposed, rendered live. Add (or a custom add control, e.g. the
 * global picker), Ask to change, Discard; draggable onto the grid on a dashboard page.
 */
export function WidgetPreviewCard({
  preview,
  onAdd,
  addControl,
  addedExtra,
  onAskChange,
  onDiscard,
  draggable = false,
  disabled = false,
}: {
  preview: WidgetPreview;
  onAdd?(p: WidgetPreview): Promise<void>;
  /** Replaces the Add button (global panel: "Add to dashboard…" picker). */
  addControl?: ReactNode;
  /** Shown next to "Added ✓" (e.g. "Open dashboard"). */
  addedExtra?: ReactNode;
  onAskChange(p: WidgetPreview): void;
  onDiscard(p: WidgetPreview): void;
  draggable?: boolean;
  /** e.g. while a reply streams (the card state can't be saved then). */
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  if (preview.status === 'discarded') return null;
  const added = preview.status === 'added';
  const canDrag = draggable && !added && !disabled && !adding;
  const { widget } = preview;

  const add = async () => {
    if (!onAdd || adding) return;
    setAdding(true);
    try {
      await onAdd(preview);
    } catch {
      // the host reports the failure (toast); the card stays pending
    } finally {
      setAdding(false);
    }
  };

  return (
    <section
      aria-label={`Preview: ${widget.title}`}
      data-testid="widget-preview"
      data-preview-id={preview.id}
      data-status={preview.status}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => startPreviewDrag(e.dataTransfer, preview) : undefined}
      onDragEnd={endPreviewDrag}
      className={cn(
        'overflow-hidden rounded-tile border border-tile-border bg-tile',
        canDrag && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <header className="flex h-9 items-center gap-1.5 border-b border-glass-border/60 px-2.5">
        {canDrag && (
          <GripVertical
            aria-hidden
            className="size-4 shrink-0 text-text-faint"
            data-testid="preview-grip"
          />
        )}
        <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-accent uppercase">
          Preview
        </span>
        <h3 className="min-w-0 truncate text-[13px] font-semibold" title={widget.title}>
          {widget.title}
        </h3>
      </header>
      <div
        className="relative min-h-0 p-3"
        style={{ height: previewHeight(preview.size.h) }}
        data-testid="preview-body"
      >
        <Suspense
          fallback={
            <div className="h-full animate-pulse rounded-md bg-glass-border/40 motion-reduce:animate-none" />
          }
        >
          <PreviewWidgetBody widget={widget} />
        </Suspense>
      </div>
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-glass-border/60 px-2.5 py-2">
        {added ? (
          <>
            <Button size="xs" variant="outline" disabled data-testid="preview-added">
              Added ✓
            </Button>
            {addedExtra}
          </>
        ) : (
          <>
            {addControl ?? (
              <Button
                size="xs"
                onClick={() => void add()}
                disabled={disabled || adding || !onAdd}
                data-testid="preview-add"
              >
                <Plus aria-hidden />
                {adding ? 'Adding…' : 'Add to dashboard'}
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onAskChange(preview)}
              data-testid="preview-ask"
            >
              <MessageSquareText aria-hidden />
              Ask to change
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onDiscard(preview)}
              disabled={disabled || adding}
              data-testid="preview-discard"
            >
              <X aria-hidden />
              Discard
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
