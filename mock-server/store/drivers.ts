import { randomUUID } from 'node:crypto';
import type { Assignment, Driver, DriverStatus } from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import { DriverSim, INITIAL_ASSIGNMENT_FROM } from '../generator/driver-sim.ts';
import type { FleetTree } from '../generator/fleet-tree.ts';
import type { VehicleSim } from '../generator/vehicle-sim.ts';
import { HttpError } from '../http-error.ts';

interface DriverFields {
  name: string;
  phone: string;
  fleetIdx: number;
  status: DriverStatus;
  userId: string | null;
  createdAt: number;
}

/**
 * Drivers and assignments: `DriverSim` plus an overlay of mutations (D-092). Generated drivers
 * are materialised only when read; edits, created drivers, user links and assignment changes
 * live in small maps. `onAssignment` fires for every opened or closed assignment.
 */
export class Drivers {
  readonly gen: DriverSim;
  private readonly patches = new Map<number, Partial<DriverFields>>();
  private readonly created: DriverFields[] = [];
  private readonly byUser = new Map<string, number>();
  /** Current driver per vehicle and vehicle per driver (-1: none). */
  private readonly vehicleDriver: Int32Array;
  private readonly driverVehicle: number[];
  /** Seed assignments that were closed, by driver: end time. */
  private readonly initialEnded = new Map<number, number>();
  /** Assignments made after start-up, per driver and per vehicle (oldest first). */
  private readonly logByDriver = new Map<number, Assignment[]>();
  private readonly logByVehicle = new Map<number, Assignment[]>();
  onAssignment: (a: Assignment) => void = () => {};

  constructor(
    seed: number,
    private readonly sim: VehicleSim,
    private readonly tree: FleetTree,
    private readonly clock: Clock,
  ) {
    this.gen = new DriverSim(seed, sim);
    this.vehicleDriver = Int32Array.from(this.gen.vehicleDriver);
    this.driverVehicle = Array.from(this.gen.driverVehicle);
  }

  get count(): number {
    return this.gen.count + this.created.length;
  }

  /** Index of a driver id, or -1. */
  indexOf(id: string): number {
    const d = DriverSim.indexOf(id);
    return d >= 0 && d < this.count ? d : -1;
  }

  /** Driver index by id, or `404`. */
  require(id: string): number {
    const d = this.indexOf(id);
    if (d < 0) throw new HttpError(404, 'not_found', `Driver ${id} not found`);
    return d;
  }

  private fields(d: number): DriverFields {
    if (d >= this.gen.count) return this.created[d - this.gen.count]!;
    const g = this.gen;
    const p = this.patches.get(d);
    return {
      name: p?.name ?? g.name(d),
      phone: p?.phone ?? g.phone(d),
      fleetIdx: p?.fleetIdx ?? g.fleet[d]!,
      status: p?.status ?? g.status(d),
      userId: p?.userId ?? null,
      createdAt: g.createdAt(d),
    };
  }

  private patch(d: number, p: Partial<DriverFields>): void {
    if (d >= this.gen.count) Object.assign(this.created[d - this.gen.count]!, p);
    else this.patches.set(d, { ...this.patches.get(d), ...p });
  }

  /** Cheap reads for list filters (no object built). */
  name(d: number): string {
    return d < this.gen.count && !this.patches.get(d)?.name
      ? this.gen.name(d)
      : this.fields(d).name;
  }
  phone(d: number): string {
    return d < this.gen.count && !this.patches.get(d)?.phone
      ? this.gen.phone(d)
      : this.fields(d).phone;
  }
  fleetIdx(d: number): number {
    return d < this.gen.count && this.patches.get(d)?.fleetIdx === undefined
      ? this.gen.fleet[d]!
      : this.fields(d).fleetIdx;
  }
  status(d: number): DriverStatus {
    return d < this.gen.count && !this.patches.get(d)?.status
      ? this.gen.status(d)
      : this.fields(d).status;
  }

  get(d: number): Driver {
    const f = this.fields(d);
    const fleet = this.tree.nodes[f.fleetIdx];
    return {
      id: this.gen.id(d),
      userId: f.userId,
      name: f.name,
      phone: f.phone,
      fleetId: fleet ? fleet.id : this.tree.rootId,
      status: f.status,
      createdAt: f.createdAt,
    };
  }

  fleetId(d: number): string {
    return this.tree.nodes[this.fleetIdx(d)]?.id ?? this.tree.rootId;
  }

  create(input: { name: string; phone: string; fleetIdx: number; status: DriverStatus }): number {
    this.created.push({ ...input, userId: null, createdAt: this.clock.now() });
    this.driverVehicle.push(-1);
    return this.count - 1;
  }

  update(
    d: number,
    p: { name?: string; phone?: string; fleetIdx?: number; status?: DriverStatus },
  ) {
    this.patch(d, p);
    if (p.status === 'disabled') this.unassign(d);
  }

  linkUser(d: number, userId: string): void {
    this.patch(d, { userId });
    this.byUser.set(userId, d);
  }

  /** The driver linked to a user, or -1. */
  byUserId(userId: string): number {
    return this.byUser.get(userId) ?? -1;
  }

  // ---- assignments ----

  vehicleOf(d: number): number {
    return this.driverVehicle[d] ?? -1;
  }

  driverOf(i: number): number {
    return this.vehicleDriver[i] ?? -1;
  }

  private initial(d: number): Assignment | null {
    const v = d < this.gen.count ? this.gen.driverVehicle[d]! : -1;
    if (v < 0) return null;
    return {
      id: `asg-${d}`,
      driverId: this.gen.id(d),
      vehicleId: this.sim.vehicleId(v),
      from: INITIAL_ASSIGNMENT_FROM,
      to: this.initialEnded.get(d) ?? null,
      by: 'system',
    };
  }

  /** A driver's assignments, oldest first. */
  driverHistory(d: number): Assignment[] {
    const first = this.initial(d);
    const log = this.logByDriver.get(d) ?? [];
    return first ? [first, ...log] : [...log];
  }

  /** A vehicle's assignments, oldest first. */
  vehicleHistory(i: number): Assignment[] {
    const d0 = this.gen.vehicleDriver[i]!;
    const first = d0 >= 0 ? this.initial(d0) : null;
    const log = this.logByVehicle.get(i) ?? [];
    return first ? [first, ...log] : [...log];
  }

  current(d: number): Assignment | null {
    if (this.vehicleOf(d) < 0) return null;
    return this.driverHistory(d).find((a) => a.to === null) ?? null;
  }

  /** Puts driver `d` on vehicle `i` (closing their current assignment); `409` if `i` has another driver. */
  assign(d: number, i: number, by: string): Assignment {
    const other = this.driverOf(i);
    if (other === d) return this.current(d)!;
    if (other >= 0) throw new HttpError(409, 'conflict', 'Vehicle already has a driver');
    if (this.status(d) === 'disabled') throw new HttpError(409, 'conflict', 'Driver is disabled');
    this.unassign(d);
    const a: Assignment = {
      id: `asg-${randomUUID()}`,
      driverId: this.gen.id(d),
      vehicleId: this.sim.vehicleId(i),
      from: this.clock.now(),
      to: null,
      by,
    };
    const push = <K>(map: Map<K, Assignment[]>, key: K) => {
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    };
    push(this.logByDriver, d);
    push(this.logByVehicle, i);
    this.vehicleDriver[i] = d;
    this.driverVehicle[d] = i;
    if (this.status(d) === 'off-duty') this.patch(d, { status: 'active' });
    this.onAssignment(a);
    return a;
  }

  /** Ends driver `d`'s current assignment, if any; returns it. */
  unassign(d: number): Assignment | null {
    const a = this.current(d);
    if (!a) return null;
    const now = this.clock.now();
    if (a.id === `asg-${d}`) this.initialEnded.set(d, now);
    else a.to = now;
    const i = this.driverVehicle[d]!;
    this.vehicleDriver[i] = -1;
    this.driverVehicle[d] = -1;
    const closed = { ...a, to: now };
    this.onAssignment(closed);
    return closed;
  }
}
