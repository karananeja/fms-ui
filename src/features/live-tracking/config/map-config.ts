import type { Bbox } from '../worker/worker-api.ts';

export const mapConfig = {
  /** Initial view (F06-R3). */
  indiaBounds: [68.1, 6.5, 97.4, 35.7] as Bbox,
  clusterRadius: 60,
  clusterMaxZoom: 14,
  /** From this zoom on, points come from a live bbox scan instead of the cluster index. */
  unclusteredZoom: 15,
  clusterRebuildMs: 2000,
  maxFramePoints: 5000,
  fitPadding: 48,
  fitMaxZoom: 14,
  /** Zoom used when the fit target is a single point. */
  singlePointZoom: 14,
  locateZoom: 16,
  locateDurationMs: 1000,
  viewportDebounceMs: 100,
};

export type MapConfig = typeof mapConfig;
