import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { FleetState } from './fleet-state.ts';

export type SearchField = 'all' | 'vin' | 'regno' | 'deviceId';

/** F08-R1: AND across fields, OR within a field; `fleetIds` include their subtrees. */
export interface VehicleFilter {
  statuses?: VehicleStatus[];
  fleetIds?: string[];
  assetTypes?: string[];
  fuelTypes?: string[];
  makes?: string[];
  models?: string[];
  socMin?: number;
  socMax?: number;
  search?: { field: SearchField; prefix: string };
}

/**
 * Shared F08/F09 contract (F08 spec §5). Consumers (map index, table, CSV, tray) only call
 * `matches(i)` and read `version`. This is a match-all stub; F08 implements the matching.
 */
export class FilterEngine {
  private filter: VehicleFilter = {};
  private _version = 0;

  constructor(private readonly state: FleetState) {}

  /** Bumps on every filter change (and, once implemented, on mask changes). */
  get version(): number {
    return this._version;
  }

  get current(): VehicleFilter {
    return this.filter;
  }

  get matchCount(): number {
    return this.state.count;
  }

  set(filter: VehicleFilter): void {
    this.filter = filter;
    this._version++;
  }

  matches(i: number): boolean {
    return i >= 0;
  }
}
