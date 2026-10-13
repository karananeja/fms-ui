import type { ExpressionSpecification, GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { withAlpha } from '@/shared/lib/color-alpha.ts';
import type { LiveTrackingState, LiveTrackingStore, LngLat } from '../store/live-tracking-store.ts';

const SOURCE = 'selected-trail';
const LINE = 'selected-trail-line';
const HALO = 'selected-trail-halo';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const line = (trail: LngLat[]): GeoJSON.Feature | GeoJSON.FeatureCollection =>
  trail.length < 2
    ? { type: 'FeatureCollection', features: [] }
    : { type: 'Feature', geometry: { type: 'LineString', coordinates: trail }, properties: {} };

/**
 * Selected vehicle's trail (F07-R12, DS1-R12 look): a teal line that fades towards the tail,
 * over a wide soft halo. Drawn under `beforeId`. Returns the unsubscribe.
 */
export function attachTrailLayer(map: MapLibre, store: LiveTrackingStore, beforeId?: string) {
  const accent = cssVar('--accent');
  const gradient: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    withAlpha(accent, 0),
    1,
    withAlpha(accent, 0.9),
  ];
  map.addSource(SOURCE, { type: 'geojson', data: line([]), lineMetrics: true });
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
  map.addLayer(
    {
      id: HALO,
      type: 'line',
      source: SOURCE,
      layout,
      paint: { 'line-color': accent, 'line-opacity': 0.25, 'line-width': 12, 'line-blur': 6 },
    },
    before,
  );
  map.addLayer(
    {
      id: LINE,
      type: 'line',
      source: SOURCE,
      layout,
      paint: { 'line-width': 4, 'line-gradient': gradient },
    },
    before,
  );

  let drawn: LngLat[] | null = null;
  const render = (s: LiveTrackingState) => {
    if (s.trail === drawn) return;
    drawn = s.trail;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(line(drawn ?? []));
  };
  render(store.getSnapshot());
  return store.subscribe(() => render(store.getSnapshot()));
}
