import {
  AttributionControl,
  Map as MapLibre,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { withAlpha } from '@/shared/lib/color-alpha';

setWorkerUrl(workerUrl);

export type LngLat = [number, number];

export interface ShareMapView {
  position: LngLat | null;
  heading: number;
  moving: boolean;
  /** `null` = the link has no trail (nothing is drawn). */
  trail: LngLat[] | null;
}

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ShareMapProbe {
  center: LngLat;
  zoom: number;
  following: boolean;
  marker: LngLat | null;
  moving: boolean;
  trailLength: number | null;
  /** `performance.now()` when the marker was first placed (navigation-relative). */
  firstMarkerAt: number | null;
  markerUpdates: number;
}

declare global {
  interface Window {
    __fmsShareMap?: ShareMapProbe;
  }
}

export const SHARE_ZOOM = 15;
const OSM =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>';
const SOURCE = 'share-trail';
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 2 L20 21 L12 16.5 L4 21 Z" style="fill:var(--accent);stroke:var(--marker-ring);stroke-width:2;stroke-linejoin:round"/></svg>';

const line = (trail: LngLat[]): GeoJSON.Feature | GeoJSON.FeatureCollection =>
  trail.length < 2
    ? { type: 'FeatureCollection', features: [] }
    : { type: 'Feature', geometry: { type: 'LineString', coordinates: trail }, properties: {} };

function markerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.testid = 'share-marker';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Vehicle position');
  el.style.cssText =
    'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--accent-halo);';
  return el;
}

function paintMarker(el: HTMLDivElement, moving: boolean): void {
  if (el.dataset.moving === String(moving)) return;
  el.dataset.moving = String(moving);
  el.innerHTML = moving
    ? ARROW_SVG
    : '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:var(--accent);border:3px solid var(--marker-ring);box-shadow:0 1px 6px var(--shadow)"></span>';
}

/**
 * F10-R10: the public page's MapLibre wiring. Starts at the vehicle (zoom 15) and follows it;
 * a user drag stops following until `recenter()`. Marker: heading arrow when moving, dot when
 * stopped. Trail (when the link has one) is a teal line under the marker.
 */
export class ShareMapController {
  readonly map: MapLibre;
  private readonly marker: Marker;
  private readonly el = markerElement();
  private view: ShareMapView = { position: null, heading: 0, moving: false, trail: null };
  private following = true;
  private placed = false;
  private loaded = false;
  private readonly probe: ShareMapProbe | null;

  constructor(
    container: HTMLElement,
    styleUrl: string,
    private readonly onFollowingChange: (following: boolean) => void,
  ) {
    this.map = new MapLibre({
      container,
      style: styleUrl,
      center: [78.9, 22.5],
      zoom: 4,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new AttributionControl({ compact: true, customAttribution: OSM }));
    this.marker = new Marker({ element: this.el, rotationAlignment: 'map' });
    this.map.on('load', () => this.onLoad(container));
    this.map.on('error', (e) => console.warn('[share-map]', e.error?.message ?? e));
    this.map.on('dragstart', () => this.setFollowing(false));

    this.probe = import.meta.env.DEV
      ? {
          center: [0, 0],
          zoom: 0,
          following: true,
          marker: null,
          moving: false,
          trailLength: null,
          firstMarkerAt: null,
          markerUpdates: 0,
        }
      : null;
    if (this.probe) {
      window.__fmsShareMap = this.probe;
      const sync = () => {
        const c = this.map.getCenter();
        this.probe!.center = [c.lng, c.lat];
        this.probe!.zoom = this.map.getZoom();
      };
      this.map.on('move', sync);
      sync();
    }
  }

  update(view: ShareMapView): void {
    const prev = this.view;
    this.view = view;
    if (view.position) {
      paintMarker(this.el, view.moving);
      this.marker.setRotation(view.moving ? view.heading : 0);
      if (!this.placed) {
        this.placed = true;
        this.marker.setLngLat(view.position).addTo(this.map);
        this.map.jumpTo({ center: view.position, zoom: SHARE_ZOOM });
        if (this.probe) this.probe.firstMarkerAt = performance.now();
      } else if (view.position !== prev.position) {
        this.marker.setLngLat(view.position);
        if (this.following) this.follow(view.position);
      }
      if (this.probe) {
        this.probe.marker = view.position;
        this.probe.moving = view.moving;
        this.probe.markerUpdates++;
      }
    }
    if (view.trail !== prev.trail) this.drawTrail();
  }

  /** Keeps the vehicle centred in the part of the map not covered by the header and card. */
  setPadding(padding: MapPadding): void {
    this.map.setPadding(padding);
    if (this.following && this.view.position) this.follow(this.view.position);
  }

  recenter(): void {
    this.setFollowing(true);
    if (this.view.position) this.follow(this.view.position);
  }

  destroy(): void {
    this.marker.remove();
    this.map.remove();
    if (this.probe && window.__fmsShareMap === this.probe) delete window.__fmsShareMap;
  }

  private follow(to: LngLat): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.map.easeTo({ center: to, duration: reduce ? 0 : 600 });
  }

  private setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    if (this.probe) this.probe.following = on;
    this.onFollowingChange(on);
  }

  private onLoad(container: HTMLElement): void {
    // Paint values can't use CSS variables: resolve the (page-scoped) accent here.
    const accent = getComputedStyle(container).getPropertyValue('--accent').trim();
    const gradient: ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      withAlpha(accent, 0.1),
      1,
      withAlpha(accent, 1),
    ];
    const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
    this.map.addSource(SOURCE, { type: 'geojson', data: line([]), lineMetrics: true });
    this.map.addLayer({
      id: `${SOURCE}-halo`,
      type: 'line',
      source: SOURCE,
      layout,
      paint: { 'line-color': accent, 'line-opacity': 0.22, 'line-width': 12, 'line-blur': 6 },
    });
    this.map.addLayer({
      id: `${SOURCE}-line`,
      type: 'line',
      source: SOURCE,
      layout,
      paint: { 'line-width': 4, 'line-gradient': gradient },
    });
    this.loaded = true;
    this.drawTrail();
  }

  private drawTrail(): void {
    const { trail } = this.view;
    if (this.probe) this.probe.trailLength = trail ? trail.length : null;
    if (!this.loaded || !trail) return;
    (this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(line(trail));
  }
}
