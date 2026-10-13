import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import {
  AttributionControl,
  Map as MapLibre,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { mapConfig } from '../config/map-config.ts';
import { STATUS_META } from '../config/status-meta.ts';
import {
  hasPermission,
  selectedPosition,
  type LiveTrackingState,
  type LiveTrackingStore,
  type LngLat,
  type MapCommand,
} from '../store/live-tracking-store.ts';
import type { MapClusters, MapFrame, MapPoints, MapViewport } from '../worker/worker-api.ts';
import { clusterLabel, clusterMarkerSvg } from './cluster-marker.ts';

setWorkerUrl(workerUrl);

const RUNNING = VEHICLE_STATUSES.indexOf('running') + 1;
const N_STATUS = VEHICLE_STATUSES.length;
const OSM =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>';

/** Resolves `var(--x)` colours once (MapLibre and SVG attributes cannot use CSS variables). */
function statusColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  return VEHICLE_STATUSES.map((s) => {
    const v = STATUS_META[s].color.match(/var\((--[\w-]+)\)/)?.[1];
    return (v && css.getPropertyValue(v).trim()) || '#9a9aa0';
  });
}

/**
 * Signed-distance image for MapLibre SDF icons (`sdf: true`): alpha 191 on the edge, ±32 per
 * pixel, like tiny-sdf with radius 8.
 */
function sdfImage(px: number, dist: (x: number, y: number) => number) {
  const data = new Uint8Array(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const a = 191 - dist(x + 0.5, y + 0.5) * 32;
      data[(y * px + x) * 4 + 3] = Math.max(0, Math.min(255, a));
    }
  }
  return { width: px, height: px, data };
}

function polygonDistance(poly: [number, number][]) {
  return (x: number, y: number) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j]!;
      const [bx, by] = poly[i]!;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? -d : d;
  };
}

const ICON_PX = 40;
const ARROW = sdfImage(
  ICON_PX,
  polygonDistance([
    [20, 6],
    [32, 33],
    [20, 26],
    [8, 33],
  ]),
);
const DOT = sdfImage(ICON_PX, (x, y) => Math.hypot(x - 20, y - 20) - 9);

const emptyCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function pointFeatures(p: MapPoints): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = new Array(p.ids.length);
  for (let k = 0; k < p.ids.length; k++) {
    features[k] = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng[k]!, p.lat[k]!] },
      properties: { id: p.ids[k], r: p.regnos[k], s: p.status[k], h: p.heading[k] || 0 },
    };
  }
  return { type: 'FeatureCollection', features };
}

interface ClusterEntry {
  marker: Marker;
  el: HTMLButtonElement;
  id: number;
  center: LngLat;
  key: string;
}

/**
 * Imperative MapLibre wiring: sources, layers, markers and events. Executes the store's map
 * commands; all decisions (what to fit, where to fly) live in the store.
 */
export class MapController {
  readonly map: MapLibre;
  private readonly colors = statusColors();
  private readonly clusters = new Map<number, ClusterEntry>();
  private readonly popup = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
  private readonly unsubscribe: (() => void)[] = [];
  private loaded = false;
  private destroyed = false;
  private frame: MapFrame | null = null;
  private highlight: LngLat | null = null;
  private viewportTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    container: HTMLElement,
    private readonly store: LiveTrackingStore,
    styleUrl: string,
  ) {
    const [w, s, e, n] = mapConfig.indiaBounds;
    this.map = new MapLibre({
      container,
      style: styleUrl,
      bounds: [w, s, e, n],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new AttributionControl({ compact: false, customAttribution: OSM }));
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    this.map.on('load', () => this.onLoad());
    this.map.on('error', (e) => console.warn('[map]', e.error?.message ?? e));
    this.map.on('movestart', () => clearTimeout(this.viewportTimer));
    this.map.on('moveend', () => {
      clearTimeout(this.viewportTimer);
      this.viewportTimer = setTimeout(() => this.sendViewport(), mapConfig.viewportDebounceMs);
    });
    this.unsubscribe.push(
      store.onMapCommand((cmd) => this.execute(cmd)),
      store.subscribe(() => this.render(store.getSnapshot())),
    );
    if (import.meta.env.DEV) {
      void import('./map-dev-probe.ts').then((m) => {
        if (!this.destroyed) m.exposeMapProbe(this.map, store, () => this.highlight);
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.viewportTimer);
    for (const off of this.unsubscribe) off();
    for (const c of this.clusters.values()) c.marker.remove();
    this.clusters.clear();
    this.popup.remove();
    this.map.remove();
    void this.store.setViewport(null);
    if (import.meta.env.DEV) delete window.__fmsMap;
  }

  private onLoad(): void {
    const map = this.map;
    map.addImage('fms-arrow', ARROW, { sdf: true, pixelRatio: 2 });
    map.addImage('fms-dot', DOT, { sdf: true, pixelRatio: 2 });
    map.addSource('vehicles', { type: 'geojson', data: emptyCollection });
    map.addSource('selected', { type: 'geojson', data: emptyCollection });
    const color = ['match', ['get', 's']] as unknown[];
    this.colors.forEach((c, k) => color.push(k + 1, c));
    color.push('#9a9aa0');
    const running: ExpressionSpecification = ['==', ['get', 's'], RUNNING];
    map.addLayer({
      id: 'selected-ring',
      type: 'circle',
      source: 'selected',
      paint: {
        'circle-radius': 15,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#f2f2f2',
      },
    });
    map.addLayer({
      id: 'vehicles',
      type: 'symbol',
      source: 'vehicles',
      layout: {
        'icon-image': ['case', running, 'fms-arrow', 'fms-dot'],
        'icon-rotate': ['case', running, ['get', 'h'], 0],
        'icon-rotation-alignment': 'map',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 1.15],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': color as ExpressionSpecification,
        'icon-halo-color': '#0e0e0f',
        'icon-halo-width': 1.2,
      },
    });
    map.on('mousemove', 'vehicles', (e) => this.hover(e));
    map.on('mouseleave', 'vehicles', () => {
      map.getCanvas().style.cursor = '';
      this.popup.remove();
    });
    map.on('click', (e) => this.click(e.point));
    this.loaded = true;
    this.frame = null;
    this.render(this.store.getSnapshot());
    this.sendViewport();
  }

  /**
   * A vehicle opens its details (with `vehicle.details.view`; otherwise the hover tooltip is all
   * there is). Empty map deselects (F07-R16); MapLibre fires no click after a drag, and cluster
   * markers stop their clicks from reaching the map.
   */
  private click(point: { x: number; y: number }): void {
    const f = this.map.queryRenderedFeatures([point.x, point.y], { layers: ['vehicles'] })[0];
    const id = f?.properties.id as string | undefined;
    const state = this.store.getSnapshot();
    if (id) {
      if (hasPermission(state, 'vehicle.details.view')) void this.store.selectVehicle(id);
    } else if (state.selectedVehicleId) {
      void this.store.selectVehicle(null);
    }
  }

  private viewport(): MapViewport {
    const b = this.map.getBounds();
    const clamp = (v: number) => Math.max(-180, Math.min(180, v));
    return {
      bbox: [clamp(b.getWest()), b.getSouth(), clamp(b.getEast()), b.getNorth()],
      zoom: this.map.getZoom(),
    };
  }

  private sendViewport(): void {
    if (this.loaded) void this.store.setViewport(this.viewport());
  }

  private execute(cmd: MapCommand): void {
    if (cmd.type === 'fit') {
      const [w, s, e, n] = cmd.bounds;
      const { padding, maxZoom } = cmd;
      this.map.fitBounds([w, s, e, n], maxZoom === undefined ? { padding } : { padding, maxZoom });
    } else if (cmd.type === 'fly') {
      this.map.flyTo({ center: cmd.center, zoom: cmd.zoom, duration: cmd.duration });
    } else {
      this.map.easeTo({ center: cmd.center, zoom: cmd.zoom });
    }
  }

  private render(state: LiveTrackingState): void {
    if (!this.loaded) return;
    if (state.mapFrame && state.mapFrame !== this.frame) {
      this.frame = state.mapFrame;
      (this.map.getSource('vehicles') as GeoJSONSource).setData(pointFeatures(this.frame.points));
      this.syncClusters(this.frame.clusters);
    }
    const pos = selectedPosition(state);
    if (pos?.[0] !== this.highlight?.[0] || pos?.[1] !== this.highlight?.[1]) {
      this.highlight = pos;
      (this.map.getSource('selected') as GeoJSONSource).setData(
        pos
          ? { type: 'Feature', geometry: { type: 'Point', coordinates: pos }, properties: {} }
          : emptyCollection,
      );
    }
  }

  /** Cluster DOM markers, reused by cluster id across frames. */
  private syncClusters(c: MapClusters): void {
    const seen = new Set<number>();
    for (let k = 0; k < c.id.length; k++) {
      const id = c.id[k]!;
      const count = c.count[k]!;
      const breakdown = c.breakdown.subarray(k * N_STATUS, (k + 1) * N_STATUS);
      const center: LngLat = [c.lng[k]!, c.lat[k]!];
      const key = `${count}:${breakdown.join(',')}`;
      seen.add(id);
      let entry = this.clusters.get(id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'fms-cluster';
        el.dataset.testid = 'map-cluster';
        entry = { el, id, center, key: '', marker: new Marker({ element: el }) };
        const e = entry;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void this.store.zoomToCluster(e.id, e.center, this.map.getZoom());
        });
        entry.marker.setLngLat(center).addTo(this.map);
        this.clusters.set(id, entry);
      } else if (entry.center[0] !== center[0] || entry.center[1] !== center[1]) {
        entry.marker.setLngLat(center);
      }
      entry.center = center;
      if (entry.key !== key) {
        entry.key = key;
        entry.el.innerHTML = clusterMarkerSvg(count, breakdown, this.colors);
        entry.el.setAttribute('aria-label', clusterLabel(count));
      }
    }
    for (const [id, entry] of this.clusters) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      this.clusters.delete(id);
    }
  }

  private hover(e: MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    this.map.getCanvas().style.cursor = 'pointer';
    const status = VEHICLE_STATUSES[(f.properties.s as number) - 1];
    const el = document.createElement('div');
    const regno = document.createElement('strong');
    regno.textContent = String(f.properties.r);
    el.append(regno, document.createElement('br'), status ? STATUS_META[status].label : '—');
    this.popup.setLngLat(e.lngLat).setDOMContent(el).addTo(this.map);
  }
}
