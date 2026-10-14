import { Map as MapLibre, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);

/** F14-R2: a static (non-interactive) MapLibre snippet with one marker at the request location. */
export function createMiniMap(
  container: HTMLElement,
  styleUrl: string,
  at: { lat: number; lng: number },
): () => void {
  const map = new MapLibre({
    container,
    style: styleUrl,
    center: [at.lng, at.lat],
    zoom: 14,
    interactive: false,
    attributionControl: false,
  });
  map.on('error', (e) => console.warn('[request-map]', e.error?.message ?? e));
  const el = document.createElement('div');
  el.dataset.testid = 'request-map-marker';
  el.style.cssText =
    'width:16px;height:16px;border-radius:9999px;background:var(--danger);border:3px solid var(--marker-ring);box-shadow:0 1px 6px var(--shadow)';
  const marker = new Marker({ element: el }).setLngLat([at.lng, at.lat]).addTo(map);
  return () => {
    marker.remove();
    map.remove();
  };
}
