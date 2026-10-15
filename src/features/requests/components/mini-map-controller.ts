import { Map as MapLibre, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ResolvedTheme } from '@/shared/theme/theme-store';

setWorkerUrl(workerUrl);

interface ThemeSource {
  resolved(): ResolvedTheme;
  subscribe(listener: () => void): () => void;
}

/**
 * F14-R2: a static (non-interactive) MapLibre snippet with one marker at the request location.
 * DS3-R15: the basemap follows the theme (`setStyle`; the DOM pin survives).
 */
export function createMiniMap(
  container: HTMLElement,
  styles: Record<ResolvedTheme, string>,
  theme: ThemeSource,
  at: { lat: number; lng: number },
): () => void {
  let current = theme.resolved();
  const map = new MapLibre({
    container,
    style: styles[current],
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
  const off = theme.subscribe(() => {
    const next = theme.resolved();
    if (next === current) return;
    current = next;
    map.setStyle(styles[next], { diff: false });
  });
  return () => {
    off();
    marker.remove();
    map.remove();
  };
}
