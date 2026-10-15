import type { WidgetPreview } from '@shared/contract/dashboards.ts';

/**
 * D-135: HTML5 drag of a chat preview card onto the dashboard grid. The payload travels in
 * `dataTransfer` (readable on drop); the grid also needs the size while dragging over, when
 * browsers hide the data, so the card being dragged is kept here too.
 */
export const PREVIEW_MIME = 'application/x-fms-widget-preview';

let active: WidgetPreview | null = null;

export function startPreviewDrag(dt: DataTransfer, preview: WidgetPreview): void {
  active = preview;
  dt.effectAllowed = 'copy';
  dt.setData(PREVIEW_MIME, JSON.stringify(preview));
  dt.setData('text/plain', preview.widget.title);
}

export function endPreviewDrag(): void {
  active = null;
}

/** The preview being dragged (dragover), or null when the drag is something else. */
export function draggedPreview(dt: DataTransfer | null): WidgetPreview | null {
  if (!dt || !Array.from(dt.types).includes(PREVIEW_MIME)) return null;
  return active;
}

/** The dropped preview (drop event): the payload, else the active drag. */
export function droppedPreview(dt: DataTransfer | null): WidgetPreview | null {
  const raw = dt?.getData(PREVIEW_MIME);
  if (raw) {
    try {
      return JSON.parse(raw) as WidgetPreview;
    } catch {
      // fall back to the active drag
    }
  }
  return draggedPreview(dt);
}
