import type { Combinfo, Lafparsed, Me } from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';

export type ConnectionState =
  'connecting' | 'live' | 'reconnecting' | 'offline' | 'unauthenticated' | 'error';

export interface LiveStats {
  vehicleCount: number;
  snapshotComplete: boolean;
  rowsPerSec: number;
  msgsPerSec: number;
  /** Browser time of the last WS message (epoch ms), or 0. */
  lastMessageAt: number;
  reconnects: number;
  /** Estimated worker memory held by the fleet state. */
  stateBytes: number;
  serverOffsetMs: number;
  /** Duration of the last full status sweep (ms). */
  sweepMs: number;
  /** Duration of the last cluster index rebuild (ms); 0 until the map asks for frames. */
  clusterBuildMs: number;
}

/** `[west, south, east, north]` in degrees. */
export type Bbox = [number, number, number, number];

export interface MapViewport {
  bbox: Bbox;
  zoom: number;
}

/** Individual vehicles in a frame (parallel arrays). `status` is the F05 code (index + 1). */
export interface MapPoints {
  lng: Float64Array;
  lat: Float64Array;
  heading: Float32Array;
  status: Uint8Array;
  ids: string[];
  regnos: string[];
}

/** Clusters in a frame; `breakdown` holds 8 per-status counts per cluster (by code − 1). */
export interface MapClusters {
  lng: Float64Array;
  lat: Float64Array;
  id: Float64Array;
  count: Uint32Array;
  breakdown: Uint32Array;
}

/** What the map draws for one viewport; typed arrays are transferred, never copied. */
export interface MapFrame {
  version: number;
  /** Zoom the frame was computed for (clusters may come from a lower zoom when capped). */
  zoom: number;
  points: MapPoints;
  clusters: MapClusters;
}

/** Full vehicle-scope payloads of the selected vehicle. */
export interface SelectedVehicle {
  vehicleId: string;
  /** False when the vehicle is not in the user's fleet state (nothing was subscribed). */
  found: boolean;
  /** Derived status (null when not in the fleet state). */
  status: VehicleStatus | null;
  combinfo: Combinfo | null;
  lafparsed: Lafparsed | null;
}

export interface LivePush {
  connection: ConnectionState;
  stats: LiveStats;
  version: number;
  statusCounts: Record<VehicleStatus, number>;
  /** Vehicles in the fleet state (= sum of `statusCounts`). */
  total: number;
  /** Present only when the selection or its payloads changed since the last push. */
  selected?: SelectedVehicle | null;
  /** Fresh frame for the current viewport, when the data changed since the last one. */
  mapFrame?: MapFrame;
}

/** One vehicle's fleet-level record (slim, from fleet state). */
export interface VehicleSummary {
  vehicleId: string;
  deviceId: string;
  regno: string;
  vin: string;
  fleetId: string;
  assetType: string;
  fuelType: string;
  make: string;
  model: string;
  variant: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  soc: number;
  dte: number;
  odometer: number;
  carbattery: number;
  devbattery: number;
  ignstatus: number;
  fixquality: number;
  immobilization_status: number;
  utctime: number;
  gpstime: number;
  canutctime: number;
  /** `canutctime` of the last applied fleet lafparsed row (NaN if none). */
  lafparsedAt: number;
  pids: Record<string, number | null>;
  status: VehicleStatus;
}

/** API the worker exposes over Comlink. Later features add query methods. */
export interface LiveTrackingWorkerApi {
  init(me: Me, onPush: (push: LivePush) => void): void;
  /** Returns false (and subscribes nothing) when the vehicle is not in the fleet state. */
  selectVehicle(vehicleId: string | null): boolean;
  getVehicleSummary(vehicleId: string): VehicleSummary | null;
  /**
   * Sets the map viewport and returns its frame; later frames arrive as `push.mapFrame`.
   * `null` (map hidden) stops frames.
   */
  setViewport(viewport: MapViewport | null): MapFrame | null;
  /** Zoom at which the cluster splits, or null if the id is stale (index rebuilt since). */
  getClusterExpansionZoom(clusterId: number): number | null;
  /** Bbox of all vehicles with a valid position, or null when there are none. */
  getBounds(): Bbox | null;
  dispose(): void;
}
