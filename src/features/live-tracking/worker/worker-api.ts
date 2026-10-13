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
  dispose(): void;
}
