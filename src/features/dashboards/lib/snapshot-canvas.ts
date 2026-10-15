/**
 * D-142: WebGL map canvases read back blank without `preserveDrawingBuffer`, which costs every
 * frame. Instead a dashboard map widget registers its map here, and only at capture time is it
 * repainted once and read inside that frame's `render` handler. The live-tracking map never
 * registers (no flag, no listener, no cost). Structural type: no maplibre import here.
 */
export interface SnapshotMap {
  getCanvas(): HTMLCanvasElement;
  once(type: 'render', listener: () => void): unknown;
  triggerRepaint(): void;
}

const maps = new Set<SnapshotMap>();

/** Call from a dashboard map widget after the map is created; returns the unregister. */
export function registerSnapshotMap(map: SnapshotMap): () => void {
  maps.add(map);
  return () => maps.delete(map);
}

function readFrame(map: SnapshotMap, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    map.once('render', () => {
      clearTimeout(t);
      try {
        resolve(map.getCanvas().toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    });
    map.triggerRepaint();
  });
}

/**
 * For each registered map inside `root`, reads one frame and makes that canvas's `toDataURL`
 * return it until the returned restore runs (modern-screenshot clones a canvas via
 * `toDataURL`).
 */
export async function freezeMapCanvases(root: Element, timeoutMs = 1500): Promise<() => void> {
  const restores: (() => void)[] = [];
  for (const map of maps) {
    const canvas = map.getCanvas();
    if (!root.contains(canvas)) continue;
    const url = await readFrame(map, timeoutMs);
    if (!url) continue;
    Object.defineProperty(canvas, 'toDataURL', { configurable: true, value: () => url });
    restores.push(() => Reflect.deleteProperty(canvas, 'toDataURL'));
  }
  return () => restores.forEach((r) => r());
}
