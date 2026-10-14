import type { Assignment, Driver, VehicleMeta } from '@shared/contract/index.ts';

/** `[vehicleId, driverId, driverName]`: one row of a compact vehicle → driver list. */
export type DriverIndexRow = readonly [vehicleId: string, driverId: string, name: string];

interface Entry {
  driverId: string;
  name: string;
  /** Upper-cased name, matched against upper-cased prefixes. */
  key: string;
}

export interface DriverMatch {
  vehicleId: string;
  driverId: string;
  name: string;
}

/** True when `prefix` (upper case) starts the name or one of its words. */
export function namePrefixMatch(key: string, prefix: string): boolean {
  if (key.startsWith(prefix)) return true;
  for (let k = key.indexOf(' '); k >= 0; k = key.indexOf(' ', k + 1)) {
    if (key.startsWith(prefix, k + 1)) return true;
  }
  return false;
}

/**
 * F12-R6 / D-095: the worker's vehicle → driver-name index. Keeps the main thread out of driver
 * search (D-005). Fed by a bulk list (`load`), by names resolved from the server while searching
 * (`set`), and by assignment events forwarded from the main thread (`apply`).
 */
export class DriverIndex {
  /** Duration of the last bulk load / match (ms). */
  buildMs = 0;
  matchMs = 0;
  private readonly byVehicle = new Map<string, Entry>();
  private readonly vehicleOfDriver = new Map<string, string>();
  /** Every driver name seen (also after their assignment ended), to name new assignments. */
  private readonly names = new Map<string, string>();

  get size(): number {
    return this.byVehicle.size;
  }

  /** Replaces the index with a full compact list. */
  load(rows: readonly DriverIndexRow[]): void {
    const t0 = performance.now();
    this.byVehicle.clear();
    this.vehicleOfDriver.clear();
    for (const [vehicleId, driverId, name] of rows) this.set(vehicleId, driverId, name);
    this.buildMs = performance.now() - t0;
  }

  has(vehicleId: string): boolean {
    return this.byVehicle.has(vehicleId);
  }

  driverOf(vehicleId: string): DriverMatch | null {
    const e = this.byVehicle.get(vehicleId);
    return e ? { vehicleId, driverId: e.driverId, name: e.name } : null;
  }

  nameOf(driverId: string): string | undefined {
    return this.names.get(driverId);
  }

  /** Puts `driverId` on `vehicleId`, dropping the driver's previous vehicle and the vehicle's previous driver. */
  set(vehicleId: string, driverId: string, name: string): void {
    this.names.set(driverId, name);
    const prevVehicle = this.vehicleOfDriver.get(driverId);
    if (prevVehicle !== undefined && prevVehicle !== vehicleId) this.byVehicle.delete(prevVehicle);
    this.delete(vehicleId);
    this.byVehicle.set(vehicleId, { driverId, name, key: name.toUpperCase() });
    this.vehicleOfDriver.set(driverId, vehicleId);
  }

  delete(vehicleId: string): void {
    const e = this.byVehicle.get(vehicleId);
    if (!e) return;
    this.byVehicle.delete(vehicleId);
    if (this.vehicleOfDriver.get(e.driverId) === vehicleId) this.vehicleOfDriver.delete(e.driverId);
  }

  /**
   * Applies an assignment event. Returns false when the new assignment's driver name is unknown
   * (the vehicle is left without an entry; the caller resolves the name and calls `set`).
   */
  apply(a: Assignment): boolean {
    if (a.to !== null) {
      if (this.byVehicle.get(a.vehicleId)?.driverId === a.driverId) this.delete(a.vehicleId);
      return true;
    }
    const name = this.names.get(a.driverId);
    if (name !== undefined) {
      this.set(a.vehicleId, a.driverId, name);
      return true;
    }
    const prev = this.vehicleOfDriver.get(a.driverId);
    if (prev !== undefined) this.delete(prev);
    this.delete(a.vehicleId);
    return false;
  }

  /** Vehicles whose driver name (or a word of it) starts with `prefix`, by name; `accept` filters. */
  match(prefix: string, limit: number, accept?: (vehicleId: string) => boolean): DriverMatch[] {
    const t0 = performance.now();
    const p = prefix.trim().toUpperCase();
    const out: DriverMatch[] = [];
    if (p && limit > 0) {
      for (const [vehicleId, e] of this.byVehicle) {
        if (!namePrefixMatch(e.key, p) || (accept && !accept(vehicleId))) continue;
        out.push({ vehicleId, driverId: e.driverId, name: e.name });
      }
      // Full-name prefix matches first, then by name.
      out.sort(
        (a, b) =>
          Number(!a.name.toUpperCase().startsWith(p)) -
            Number(!b.name.toUpperCase().startsWith(p)) || a.name.localeCompare(b.name),
      );
      out.length = Math.min(out.length, limit);
    }
    this.matchMs = performance.now() - t0;
    return out;
  }
}

export type FetchJson = (path: string) => Promise<unknown>;

/** Server candidates fetched per driver search (substring of the driver name, in scope). */
const CANDIDATES = 100;
/** Names resolved per search (one `GET /vehicles/:id/driver` each, in parallel). */
const RESOLVE_MAX = 16;
const FILLED_MAX = 200;

/**
 * F12-R6 without a compact endpoint in F11: before matching, `fill(prefix)` asks the server for
 * vehicles whose driver name contains the prefix (`GET /vehicles?driver=`, `live.view`) and
 * resolves the names it doesn't know yet (`GET /vehicles/:id/driver`). Prefixes already filled
 * are answered from the index alone; assignment events keep it current meanwhile.
 */
export class DriverSearch {
  /** Prefixes (upper case) whose candidates are all in the index. */
  private readonly filled = new Set<string>();

  constructor(
    readonly index: DriverIndex,
    private readonly fetchJson: FetchJson,
  ) {}

  /** Names the driver of a new assignment event (the event carries only the driver id). */
  async apply(a: Assignment): Promise<void> {
    if (this.index.apply(a)) return;
    const d = (await this.fetchJson(
      `/api/vehicles/${encodeURIComponent(a.vehicleId)}/driver`,
    ).catch(() => null)) as Driver | null;
    if (d && d.id === a.driverId) this.index.set(a.vehicleId, d.id, d.name);
  }

  async fill(prefix: string, known: (vehicleId: string) => boolean): Promise<void> {
    const p = prefix.trim().toUpperCase();
    if (!p || this.filled.has(p)) return;
    const page = (await this.fetchJson(
      `/api/vehicles?driver=${encodeURIComponent(prefix.trim())}&limit=${CANDIDATES}`,
    ).catch(() => null)) as { items: VehicleMeta[]; nextCursor: string | null } | null;
    if (!page) return;
    const unknown = page.items
      .map((v) => v.vehicleId)
      .filter((id) => known(id) && !this.index.has(id));
    const batch = unknown.slice(0, RESOLVE_MAX);
    const drivers = await Promise.all(
      batch.map(
        (id) =>
          this.fetchJson(`/api/vehicles/${encodeURIComponent(id)}/driver`).catch(
            () => null,
          ) as Promise<Driver | null>,
      ),
    );
    let resolved = 0;
    batch.forEach((id, k) => {
      const d = drivers[k];
      if (!d) return;
      this.index.set(id, d.id, d.name);
      resolved++;
    });
    if (resolved === unknown.length && page.nextCursor === null) {
      if (this.filled.size >= FILLED_MAX) this.filled.clear();
      this.filled.add(p);
    }
  }

  /** Forgets filled prefixes (after a bulk reload or a reconnect). */
  reset(): void {
    this.filled.clear();
  }
}
