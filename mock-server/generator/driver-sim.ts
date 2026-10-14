import type { DriverStatus } from '@shared/contract/index.ts';
import { DRIVER_FIRST_NAMES, DRIVER_LAST_NAMES } from './catalogue.ts';
import { hash32, unit } from './random.ts';
import { PERSONA, type VehicleSim } from './vehicle-sim.ts';

/** Drivers per vehicle. */
export const DRIVER_SHARE = 0.85;
/** Share of `normal` vehicles that start with a driver (others are spares for replacements). */
export const ASSIGNED_SHARE = 0.85;
/** Seed assignments start here (before any analytics window). */
export const INITIAL_ASSIGNMENT_FROM = Date.UTC(2026, 0, 1);
const CREATED_FROM = Date.UTC(2025, 6, 1);
const DAY = 86_400_000;

const S = { assign: 101, home: 102, name: 103, phone: 104, status: 105, created: 106 } as const;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * Deterministic drivers and their initial assignments (D-092). Every field is a pure function of
 * (seed, driver index); the only allocations are a few typed arrays, so 85k drivers cost no objects.
 * Driver `d` with `d < assignedCount` starts on vehicle `driverVehicle[d]` (a `normal` vehicle).
 */
export class DriverSim {
  readonly count: number;
  readonly assignedCount: number;
  /** Initial driver of each vehicle, or -1. */
  readonly vehicleDriver: Int32Array;
  /** Initial vehicle of each driver, or -1. */
  readonly driverVehicle: Int32Array;
  /** Home fleet index of each driver. */
  readonly fleet: Uint32Array;

  constructor(
    readonly seed: number,
    sim: VehicleSim,
  ) {
    this.count = Math.floor(sim.count * DRIVER_SHARE);
    this.vehicleDriver = new Int32Array(sim.count).fill(-1);
    this.driverVehicle = new Int32Array(this.count).fill(-1);
    this.fleet = new Uint32Array(this.count);
    let d = 0;
    for (let i = 0; i < sim.count && d < this.count; i++) {
      if (sim.persona[i] !== PERSONA.normal || unit(seed + S.assign, i) >= ASSIGNED_SHARE) continue;
      this.vehicleDriver[i] = d;
      this.driverVehicle[d] = i;
      this.fleet[d] = sim.fleet[i]!;
      d++;
    }
    this.assignedCount = d;
    // Spare drivers live where the vehicles are (the fleet of a seeded vehicle).
    for (; d < this.count; d++) this.fleet[d] = sim.fleet[hash32(seed + S.home, d) % sim.count]!;
  }

  id(d: number): string {
    return `drv-${d}`;
  }

  /** Index of a driver id (`drv-<n>`), or -1; `n` may exceed `count` (drivers created later). */
  static indexOf(id: string): number {
    if (!id.startsWith('drv-')) return -1;
    const d = Number(id.slice(4));
    return Number.isInteger(d) && d >= 0 && String(d) === id.slice(4) ? d : -1;
  }

  name(d: number): string {
    const h = hash32(this.seed + S.name, d);
    return `${DRIVER_FIRST_NAMES[h % DRIVER_FIRST_NAMES.length]} ${DRIVER_LAST_NAMES[(h >>> 12) % DRIVER_LAST_NAMES.length]}`;
  }

  /** `+91 9xxxx xxxxx`; the last five digits are unique below 100k drivers. */
  phone(d: number): string {
    const head = hash32(this.seed + S.phone, d) % 10_000;
    const tail = (d * 48_271 + this.seed) % 100_000;
    return `+91 9${pad(head, 4)} ${pad(tail, 5)}`;
  }

  createdAt(d: number): number {
    return CREATED_FROM + Math.floor(unit(this.seed + S.created, d) * 150) * DAY;
  }

  status(d: number): DriverStatus {
    if (this.driverVehicle[d]! >= 0) return 'active';
    const u = unit(this.seed + S.status, d);
    return u < 0.1 ? 'disabled' : u < 0.3 ? 'active' : 'off-duty';
  }
}
