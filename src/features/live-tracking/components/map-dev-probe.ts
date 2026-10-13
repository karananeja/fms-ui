import type { Map as MapLibre } from 'maplibre-gl';
import type { LiveTrackingStore, LngLat } from '../store/live-tracking-store.ts';

declare global {
  interface Window {
    __fmsMap?: Record<string, unknown>;
  }
}

/** Dev-only `window.__fmsMap` probe for e2e (F06-R21); never part of a production build. */
export function exposeMapProbe(
  map: MapLibre,
  store: LiveTrackingStore,
  highlight: () => LngLat | null,
): void {
  const frame = () => store.getSnapshot().mapFrame;
  window.__fmsMap = {
    get center() {
      const c = map.getCenter();
      return [c.lng, c.lat];
    },
    get zoom() {
      return map.getZoom();
    },
    get bounds() {
      return map.getBounds().toArray().flat();
    },
    get frameVersion() {
      return frame()?.version ?? 0;
    },
    get clusterCount() {
      return frame()?.clusters.id.length ?? 0;
    },
    get pointCount() {
      return frame()?.points.ids.length ?? 0;
    },
    get autoFitDone() {
      return store.autoFitDone;
    },
    get vehicleCount() {
      return store.getSnapshot().total;
    },
    get moving() {
      return map.isMoving();
    },
    get selectedVehicleId() {
      return store.getSnapshot().selectedVehicleId;
    },
    highlight: () => highlight(),
    /** Points of the current frame in client (page) coordinates. */
    points: (limit = 20) => {
      const p = frame()?.points;
      if (!p) return [];
      const rect = map.getContainer().getBoundingClientRect();
      return p.ids.slice(0, limit).map((id, k) => {
        const xy = map.project([p.lng[k]!, p.lat[k]!]);
        return { id, lng: p.lng[k], lat: p.lat[k], x: rect.left + xy.x, y: rect.top + xy.y };
      });
    },
  };
}
