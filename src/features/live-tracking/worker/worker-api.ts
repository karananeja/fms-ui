import type { Assignment, Combinfo, Lafparsed, Me } from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { FleetNode, SearchField, VehicleFilter } from './filter-engine.ts';
import type { DriverIndexRow } from './driver-index.ts';
import type { Suggestion } from './search-index.ts';
import type { TableRow, TableSort } from '../config/table-columns.ts';
import type { CsvRequest, CsvResult } from './csv-exporter.ts';
import type { SessionHistory } from './selected-history.ts';
import type { TableQuery, TableResult } from './table-query.ts';
import type { TrayCard } from './tray-query.ts';
import type {
  LiveListFilter,
  LiveWidgetBatch,
  LiveWidgetQuery,
  LiveWidgetResult,
} from './widget-query.ts';

export type { LiveListFilter, LiveWidgetBatch, LiveWidgetQuery, LiveWidgetResult };

export type { CsvRequest, CsvResult, TableQuery, TableResult, TableRow, TableSort, TrayCard };

export type { DriverIndexRow, FleetNode, SearchField, Suggestion, VehicleFilter };

/** F12-R6: the status-bar search fields (`driver` suggests only; it never becomes a filter). */
export type SuggestField = SearchField | 'driver';

/** F08-R6: distinct values present in the fleet state (models carry their make). */
export interface FilterOptions {
  assetTypes: string[];
  fuelTypes: string[];
  makes: string[];
  models: { make: string; model: string }[];
}

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
  /** Session buffer since selection (absent in tests / until the first push). */
  history?: SessionHistory;
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
  // ---- F08 ----
  /** Per-status counts over every filter except `statuses` (F08-R3). */
  filteredCounts: Record<VehicleStatus, number>;
  /** Vehicles matching the whole filter. */
  filteredTotal: number;
  /** False when the selected vehicle exists but is hidden by the filter (F08-R13). */
  selectedMatches: boolean;
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
  /** Bbox of all (filter-matching) vehicles with a valid position, or null when there are none. */
  getBounds(): Bbox | null;
  dispose(): void;
  // ---- F08 ----
  /** Applies a filter (F08-R1); the map rebuilds at once and the next push carries new counts. */
  setFilter(filter: VehicleFilter): void;
  /** Fleet tree used to expand `fleetIds` to subtrees. */
  setFleets(fleets: FleetNode[]): void;
  suggest(prefix: string, field: SearchField, limit?: number): Suggestion[];
  getFilterOptions(): FilterOptions;
  // ---- F09 ----
  /** Fleet id → name, for the table's Fleet column, its sort and the CSV. */
  setFleetNames(names: Record<string, string>): void;
  /** A sorted window of matching vehicles (all or a bbox), ≤ 200 rows. */
  queryTable(query: TableQuery): TableResult;
  /** The table's rows as CSV (same scope, filter, sort, columns); progress per 10 000 rows. */
  exportCsv(
    req: CsvRequest,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CsvResult>;
  /** Up to `limit` matching vehicles in the bbox for the tray. */
  getTray(bbox: Bbox, limit?: number): TrayCard[];
  // ---- F12 ----
  /** Vehicles whose current driver's name (or a word of it) starts with `prefix` (D-095). */
  suggestDriver(prefix: string, limit?: number): Promise<Suggestion[]>;
  /** An `assignment` event forwarded from the main thread (WS `events`). */
  applyAssignment(a: Assignment): Promise<void>;
  /** Replaces the driver index with a compact vehicle → driver list (bulk source, if any). */
  loadDriverIndex(rows: DriverIndexRow[]): void;
  // ---- F20 ----
  /**
   * D-129: read-only dashboard widget queries (≤ 24). Never touches the global filter, viewport,
   * selection, table order or tray, and never pushes. `results` is null when unchanged.
   */
  queryWidgets(queries: LiveWidgetQuery[], sinceVersion?: number): LiveWidgetBatch;
}
