import { SNAPSHOT_MAX_BYTES, type SnapshotTheme } from '@shared/contract/dashboards.ts';
import { formatUpdated } from './format';

/** D-142 (addendum-snapshots.md): output size, byte target and staleness. */
export const SNAPSHOT_WIDTH = 640;
export const SNAPSHOT_HEIGHT = 400;
export const SNAPSHOT_TARGET_BYTES = 40 * 1024;
export const SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
export const SNAPSHOT_QUALITIES = [0.8, 0.65, 0.5, 0.35] as const;

export interface SnapshotMeta {
  capturedAt: number;
  theme: SnapshotTheme;
}

/** A capture is due with no snapshot, an old one, one in the other theme, or one older than the last change. */
export function isSnapshotDue(
  meta: SnapshotMeta | null,
  ctx: { now: number; theme: SnapshotTheme; updatedAt: number },
): boolean {
  if (!meta) return true;
  return (
    meta.theme !== ctx.theme ||
    ctx.now - meta.capturedAt > SNAPSHOT_MAX_AGE_MS ||
    ctx.updatedAt > meta.capturedAt
  );
}

/**
 * Encodes at falling WebP qualities until the image fits the 40 KB target. Where the browser
 * can't encode WebP (the blob comes back as PNG) one PNG is used if it fits the server cap.
 * Otherwise the smallest WebP under the cap, or `null`.
 */
export async function fitEncoded(
  encode: (type: string, quality?: number) => Promise<Blob | null>,
): Promise<Blob | null> {
  let best: Blob | null = null;
  for (const q of SNAPSHOT_QUALITIES) {
    const blob = await encode('image/webp', q);
    if (!blob) return null;
    if (blob.type !== 'image/webp') {
      const pngBlob = blob.type === 'image/png' ? blob : await encode('image/png');
      return pngBlob && pngBlob.size <= SNAPSHOT_MAX_BYTES ? pngBlob : null;
    }
    if (blob.size <= SNAPSHOT_TARGET_BYTES) return blob;
    if (!best || blob.size < best.size) best = blob;
  }
  return best && best.size <= SNAPSHOT_MAX_BYTES ? best : null;
}

/** `just now`, `N min ago`, `N h ago` (< 24 h), else the F20 "updated" format. */
export function snapshotAgeText(capturedAt: number, now: number): string {
  const min = Math.floor(Math.max(0, now - capturedAt) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatUpdated(capturedAt, now);
}

/** The captured band: the top `width × 400/640` px of the grid. */
export const captureHeight = (width: number) =>
  Math.round((width * SNAPSHOT_HEIGHT) / SNAPSHOT_WIDTH);

/**
 * At least one widget, nothing dragged or resized, and no widget inside the captured band still
 * loading or refreshing (widgets below it don't hold the capture up).
 */
export function gridReady(grid: Element): boolean {
  if (grid.querySelector('.react-draggable-dragging, .resizing, .react-grid-placeholder'))
    return false;
  const widgets = [...grid.querySelectorAll('[data-testid="widget"]')];
  if (!widgets.length) return false;
  const top = grid.getBoundingClientRect().top;
  const band = captureHeight(grid.clientWidth);
  return widgets.every(
    (w) =>
      (band > 0 && w.getBoundingClientRect().top - top >= band) ||
      !w.querySelector(
        '[data-testid="widget-state"][data-state="loading"], [data-testid="widget-refreshing"]',
      ),
  );
}
