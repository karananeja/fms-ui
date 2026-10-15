import {
  LngLatBounds,
  Map as MapLibre,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ResolvedTheme } from '@/shared/theme/theme-store';

setWorkerUrl(workerUrl);

interface ThemeSource {
  resolved(): ResolvedTheme;
  subscribe(listener: () => void): () => void;
}

export interface MapPoint {
  id: string;
  lng: number;
  lat: number;
  /** CSS colour (a `var(--…)` token is resolved against the container). */
  color: string;
  /** Radius in px. */
  radius: number;
}

export interface MapOptions {
  cluster: boolean;
  follow: boolean;
  fit: boolean;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * F26 (D-146): a dashboard map mark. MapLibre GeoJSON source with its built-in clustering (runs
 * in MapLibre's own worker), a trail line, follow (keeps one vehicle centred) and auto-fit once.
 * The basemap follows the theme; data is re-applied after a style swap.
 */
export class CustomMapController {
  readonly map: MapLibre;
  private points: MapPoint[] = [];
  private trail: [number, number][] = [];
  private fitted = false;
  private ready = false;
  private readonly off: () => void;

  constructor(
    private readonly container: HTMLElement,
    styles: Record<ResolvedTheme, string>,
    theme: ThemeSource,
    private readonly opts: MapOptions,
  ) {
    let current = theme.resolved();
    this.map = new MapLibre({
      container,
      style: styles[current],
      center: [78.9, 22.5],
      zoom: 3.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.on('error', (e) => console.warn('[custom-map]', e.error?.message ?? e));
    this.map.on('style.load', () => this.addLayers());
    this.map.on('click', 'custom-clusters', (e) => {
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      this.map.easeTo({
        center: f.geometry.coordinates as [number, number],
        zoom: this.map.getZoom() + 2,
      });
    });
    this.off = theme.subscribe(() => {
      const next = theme.resolved();
      if (next === current) return;
      current = next;
      this.ready = false;
      this.map.setStyle(styles[next], { diff: false });
    });
  }

  private css(color: string): string {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(color);
    if (!m) return color;
    // Tokens only (DS3); an unresolved token falls back to a neutral named colour.
    return getComputedStyle(this.container).getPropertyValue(m[1]!).trim() || 'gray';
  }

  private addLayers(): void {
    const map = this.map;
    const accent = this.css('var(--accent)');
    const ring = this.css('var(--marker-ring)');
    map.addSource('custom-trail', { type: 'geojson', data: EMPTY });
    map.addSource('custom-points', {
      type: 'geojson',
      data: EMPTY,
      cluster: this.opts.cluster,
      clusterRadius: 48,
      clusterMaxZoom: 13,
    });
    map.addLayer({
      id: 'custom-trail-line',
      type: 'line',
      source: 'custom-trail',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': 3, 'line-opacity': 0.85 },
    });
    if (this.opts.cluster)
      map.addLayer({
        id: 'custom-clusters',
        type: 'circle',
        source: 'custom-points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': accent,
          'circle-opacity': 0.75,
          'circle-stroke-color': ring,
          'circle-stroke-width': 2,
          'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 12, 100, 20, 1000, 28],
        },
      });
    map.addLayer({
      id: 'custom-points',
      type: 'circle',
      source: 'custom-points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'c'],
        'circle-radius': ['get', 'r'],
        'circle-stroke-color': ring,
        'circle-stroke-width': 1.5,
      },
    });
    this.ready = true;
    this.apply();
  }

  setPoints(points: MapPoint[]): void {
    this.points = points;
    this.apply();
  }

  setTrail(coords: [number, number][]): void {
    this.trail = coords;
    this.apply();
  }

  private apply(): void {
    if (!this.ready) return;
    const colors = new Map<string, string>();
    const color = (c: string) => {
      let v = colors.get(c);
      if (!v) colors.set(c, (v = this.css(c)));
      return v;
    };
    (this.map.getSource('custom-points') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: this.points.map((p) => ({
        type: 'Feature',
        properties: { id: p.id, c: color(p.color), r: p.radius },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
    (this.map.getSource('custom-trail') as GeoJSONSource | undefined)?.setData(
      this.trail.length > 1
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: this.trail },
          }
        : EMPTY,
    );
    this.position();
  }

  private position(): void {
    const first = this.points[0];
    if (this.opts.follow && first) {
      const center: [number, number] = [first.lng, first.lat];
      if (!this.fitted) this.map.jumpTo({ center, zoom: 14 });
      else this.map.easeTo({ center, duration: 600 });
      this.fitted = true;
      return;
    }
    if (this.fitted || !this.opts.fit) return;
    const all: [number, number][] = [...this.points.map((p) => [p.lng, p.lat] as [number, number]), ...this.trail];
    if (!all.length) return;
    this.fitted = true;
    if (all.length === 1) {
      this.map.jumpTo({ center: all[0]!, zoom: 13 });
      return;
    }
    const b = new LngLatBounds(all[0]!, all[0]!);
    for (const c of all) b.extend(c);
    this.map.fitBounds(b, { padding: 32, maxZoom: 14, duration: 0 });
  }

  resize(): void {
    this.map.resize();
  }

  destroy(): void {
    this.off();
    this.map.remove();
  }
}
