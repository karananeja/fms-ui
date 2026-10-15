/**
 * D-142: renders the dashboard grid to a ~640×400 WebP. The only `modern-screenshot` importer;
 * loaded with a dynamic `import()` from the `/dashboards/$id` page, so it is never part of the
 * main or list chunks.
 */
import { domToCanvas } from 'modern-screenshot';
import { freezeMapCanvases } from './snapshot-canvas';
import { captureHeight, fitEncoded, SNAPSHOT_HEIGHT, SNAPSHOT_WIDTH } from './snapshot-rules';

/** Never part of a snapshot, even inside the grid. */
const EXCLUDED =
  '.react-grid-placeholder, .react-resizable-handle, [data-snapshot-exclude], [data-testid="widget-menu"]';

/** The theme's page background (DS3 `--bg`), so the snapshot matches the theme it was taken in. */
function pageBackground(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ||
    getComputedStyle(document.body).backgroundColor
  );
}

export async function captureGrid(grid: HTMLElement): Promise<Blob | null> {
  const width = grid.clientWidth;
  if (width < 50) return null;
  const height = Math.min(grid.scrollHeight, captureHeight(width));
  const restore = await freezeMapCanvases(grid);
  let shot: HTMLCanvasElement;
  try {
    shot = await domToCanvas(grid, {
      width,
      height,
      scale: SNAPSHOT_WIDTH / width,
      backgroundColor: pageBackground(),
      filter: (n) => !(n instanceof Element && n.matches(EXCLUDED)),
      timeout: 10_000,
    });
  } finally {
    restore();
  }
  // Fixed 640×400 output: the band is drawn at the top, any short grid leaves background below.
  const out = document.createElement('canvas');
  out.width = SNAPSHOT_WIDTH;
  out.height = SNAPSHOT_HEIGHT;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = pageBackground();
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(shot, 0, 0, out.width, (shot.height * out.width) / shot.width);
  return fitEncoded(
    (type, quality) => new Promise((resolve) => out.toBlob(resolve, type, quality)),
  );
}
