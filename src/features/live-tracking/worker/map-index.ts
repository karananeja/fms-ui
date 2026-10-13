import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import Supercluster, { type ClusterFeature, type PointFeature } from 'supercluster';
import { mapConfig, type MapConfig } from '../config/map-config.ts';
import type { FleetState } from './fleet-state.ts';
import { isValidPosition } from './position.ts';
import type { Bbox, MapClusters, MapFrame, MapPoints, MapViewport } from './worker-api.ts';

const N_STATUS = VEHICLE_STATUSES.length;

interface PointProps {
  id: string;
  /** Status code at build time. */
  s: number;
}
/** Per-status counts keyed by code − 1 (flat, so supercluster's shallow clone is safe). */
type Breakdown = Record<number, number>;
type Feature = ClusterFeature<Breakdown> | PointFeature<PointProps>;

const toBreakdown = ({ s }: PointProps): Breakdown => {
  const b: Breakdown = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  if (s > 0) b[s - 1] = 1;
  return b;
};
const addBreakdown = (a: Breakdown, b: Readonly<Breakdown>) => {
  for (let k = 0; k < N_STATUS; k++) a[k]! += b[k]!;
};

type MapIndexOptions = Pick<
  MapConfig,
  'clusterRadius' | 'clusterMaxZoom' | 'unclusteredZoom' | 'clusterRebuildMs' | 'maxFramePoints'
>;

/**
 * Viewport queries over the live fleet state: a supercluster index (rebuilt on a throttle) for
 * zooms below `unclusteredZoom`, a live bbox scan above it.
 */
export class MapIndex {
  readonly opts: MapIndexOptions;
  buildMs = 0;
  builds = 0;
  private index: Supercluster<PointProps, Breakdown> | null = null;
  private builtAt = -Infinity;
  private builtVersion = -1;
  private version = 0;
  private scratch: Int32Array;

  constructor(
    private readonly state: FleetState,
    opts: Partial<MapIndexOptions> = {},
  ) {
    this.opts = { ...mapConfig, ...opts };
    this.scratch = new Int32Array(this.opts.maxFramePoints + 1);
  }

  /** Rebuilds when the data changed and the throttle allows (or there is no index yet); `force` skips the throttle. */
  update(dataVersion: number, now: number, force = false): boolean {
    if (this.index && (dataVersion === this.builtVersion || (!force && !this.rebuildDue(now))))
      return false;
    this.rebuild(dataVersion, now);
    return true;
  }

  /** Ms until a pending rebuild may run, or null when the index is current. */
  rebuildWait(dataVersion: number, now: number): number | null {
    if (!this.index || dataVersion === this.builtVersion) return null;
    return Math.max(0, this.builtAt + this.opts.clusterRebuildMs - now);
  }

  frame({ bbox, zoom }: MapViewport): MapFrame {
    const z = Math.floor(zoom);
    const max = this.opts.maxFramePoints;
    if (z >= this.opts.unclusteredZoom) {
      const n = this.scan(bbox, max + 1);
      if (n <= max) return this.pack(zoom, this.scratch.subarray(0, n), []);
    }
    const index = this.ensureIndex();
    for (let qz = Math.min(z, this.opts.clusterMaxZoom); ; qz--) {
      const features = index.getClusters(bbox, qz) as Feature[];
      const clusters: ClusterFeature<Breakdown>[] = [];
      let n = 0;
      for (const f of features) {
        if ('cluster' in f.properties) clusters.push(f as ClusterFeature<Breakdown>);
        else n++;
      }
      if (n > max && qz > 0) continue;
      let k = 0;
      for (const f of features) {
        if ('cluster' in f.properties) continue;
        const i = this.state.byVehicle.get((f.properties as PointProps).id);
        if (i !== undefined && this.valid(i)) this.scratch[k++] = i;
      }
      return this.pack(zoom, this.scratch.subarray(0, k), clusters);
    }
  }

  expansionZoom(clusterId: number): number | null {
    try {
      return this.index?.getClusterExpansionZoom(clusterId) ?? null;
    } catch {
      return null;
    }
  }

  bounds(): Bbox | null {
    const { lat, lng } = this.state.cols;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (let i = 0; i < this.state.count; i++) {
      const y = lat[i]!;
      const x = lng[i]!;
      if (!isValidPosition(y, x)) continue;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    return w === Infinity ? null : [w, s, e, n];
  }

  private rebuildDue(now: number) {
    return now - this.builtAt >= this.opts.clusterRebuildMs;
  }

  private ensureIndex() {
    if (!this.index) this.rebuild(this.builtVersion, this.builtAt);
    return this.index!;
  }

  private valid(i: number) {
    return isValidPosition(this.state.cols.lat[i]!, this.state.cols.lng[i]!);
  }

  private rebuild(dataVersion: number, now: number): void {
    const t0 = performance.now();
    const { lat, lng, status } = this.state.cols;
    const ids = this.state.str.vehicleId;
    const features: PointFeature<PointProps>[] = [];
    for (let i = 0; i < this.state.count; i++) {
      const y = lat[i]!;
      const x = lng[i]!;
      if (!isValidPosition(y, x)) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x, y] },
        properties: { id: ids[i]!, s: status![i]! },
      });
    }
    this.index = new Supercluster<PointProps, Breakdown>({
      radius: this.opts.clusterRadius,
      maxZoom: this.opts.clusterMaxZoom,
      map: toBreakdown,
      reduce: addBreakdown,
    }).load(features);
    this.builtVersion = dataVersion;
    this.builtAt = now;
    this.builds++;
    this.buildMs = performance.now() - t0;
  }

  /** Live bbox scan into `scratch`; stops at `limit` hits. */
  private scan([w, s, e, n]: Bbox, limit: number): number {
    const { lat, lng } = this.state.cols;
    let k = 0;
    for (let i = 0; i < this.state.count && k < limit; i++) {
      const y = lat[i]!;
      const x = lng[i]!;
      if (y >= s && y <= n && x >= w && x <= e && isValidPosition(y, x)) this.scratch[k++] = i;
    }
    return k;
  }

  private pack(zoom: number, idx: Int32Array, clusters: ClusterFeature<Breakdown>[]): MapFrame {
    const { lat, lng, heading, status } = this.state.cols;
    const { vehicleId, regno } = this.state.str;
    const n = idx.length;
    const points: MapPoints = {
      lng: new Float64Array(n),
      lat: new Float64Array(n),
      heading: new Float32Array(n),
      status: new Uint8Array(n),
      ids: new Array<string>(n),
      regnos: new Array<string>(n),
    };
    for (let k = 0; k < n; k++) {
      const i = idx[k]!;
      points.lng[k] = lng[i]!;
      points.lat[k] = lat[i]!;
      points.heading[k] = heading[i]!;
      points.status[k] = status![i]!;
      points.ids[k] = vehicleId[i]!;
      points.regnos[k] = regno[i]!;
    }
    const m = clusters.length;
    const out: MapClusters = {
      lng: new Float64Array(m),
      lat: new Float64Array(m),
      id: new Float64Array(m),
      count: new Uint32Array(m),
      breakdown: new Uint32Array(m * N_STATUS),
    };
    for (let k = 0; k < m; k++) {
      const { geometry, properties: p } = clusters[k]!;
      out.lng[k] = geometry.coordinates[0]!;
      out.lat[k] = geometry.coordinates[1]!;
      out.id[k] = p.cluster_id;
      out.count[k] = p.point_count;
      for (let j = 0; j < N_STATUS; j++) out.breakdown[k * N_STATUS + j] = p[j]!;
    }
    return { version: ++this.version, zoom, points, clusters: out };
  }
}

/** Buffers to transfer with a frame. */
export const frameBuffers = ({ points: p, clusters: c }: MapFrame): ArrayBuffer[] =>
  [p.lng, p.lat, p.heading, p.status, c.lng, c.lat, c.id, c.count, c.breakdown].map(
    (a) => a.buffer as ArrayBuffer,
  );
