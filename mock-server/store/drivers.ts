import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Assignment, Driver, DriverStatus } from '@shared/contract/index.ts';
import type { Clock } from '../clock.ts';
import { atomic } from '../db/database.ts';
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

const SQL = {
  patch: `INSERT INTO driver_patches (driver_idx, name, phone, fleet_idx, status, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (driver_idx) DO UPDATE SET name = excluded.name, phone = excluded.phone,
      fleet_idx = excluded.fleet_idx, status = excluded.status, user_id = excluded.user_id`,
  insertCreated: `INSERT INTO drivers_created (driver_idx, name, phone, fleet_idx, status, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  updateCreated: `UPDATE drivers_created SET name = ?, phone = ?, fleet_idx = ?, status = ?, user_id = ?
    WHERE driver_idx = ?`,
  endInitial: 'INSERT OR REPLACE INTO initial_assignment_ends (driver_idx, ended_at) VALUES (?, ?)',
  insertAssignment: `INSERT INTO assignments (id, driver_idx, vehicle_id, from_at, to_at, by)
    VALUES (?, ?, ?, ?, NULL, ?)`,
  closeAssignment: 'UPDATE assignments SET to_at = ? WHERE id = ?',
} as const;

interface PatchRow {
  driver_idx: number;
  name: string | null;
  phone: string | null;
  fleet_idx: number | null;
  status: DriverStatus | null;
  user_id: string | null;
}
interface CreatedRow {
  driver_idx: number;
  name: string;
  phone: string;
  fleet_idx: number;
  status: DriverStatus;
  user_id: string | null;
  created_at: number;
}
interface AssignmentRow {
  id: string;
  driver_idx: number;
  vehicle_id: string;
  from_at: number;
  to_at: number | null;
  by: string;
}

/**
 * Drivers and assignments: `DriverSim` plus an overlay of mutations (D-092). Generated drivers
 * are materialised only when read; edits, created drivers, user links and assignment changes
 * live in small maps, written through to `fms.db` (F22) and replayed by `hydrate`.
 * `onAssignment` fires for every opened or closed assignment.
 */
export class Drivers {
  readonly gen: DriverSim;
  private readonly patches = new Map<number, Partial<DriverFields>>();
  private readonly created: DriverFields[] = [];
  private readonly byUser = new Map<string, number>();
  /** Current driver per vehicle and vehicle per driver (-1: none). */
  private readonly vehicleDriver: Int32Array;
  private readonly driverVehicle: number[];
  private readonly stmt: Record<keyof typeof SQL, StatementSync>;
  /** Seed assignments that were closed, by driver: end time. */
  private readonly initialEnded = new Map<number, number>();
  /** Assignments made after start-up, per driver and per vehicle (oldest first). */
  private readonly logByDriver = new Map<number, Assignment[]>();
  private readonly logByVehicle = new Map<number, Assignment[]>();
  onAssignment: (a: Assignment) => void = () => {};

  constructor(
    private readonly db: DatabaseSync,
    seed: number,
    private readonly sim: VehicleSim,
    private readonly tree: FleetTree,
    private readonly clock: Clock,
  ) {
    this.gen = new DriverSim(seed, sim);
    this.vehicleDriver = Int32Array.from(this.gen.vehicleDriver);
    this.driverVehicle = Array.from(this.gen.driverVehicle);
    this.stmt = Object.fromEntries(
      Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]),
    ) as Record<keyof typeof SQL, StatementSync>;
  }

  /** Rebuilds the overlay from the database: patches, created drivers, then replays assignments. */
  hydrate(): void {
    const { db, gen } = this;
    this.patches.clear();
    this.created.length = 0;
    this.byUser.clear();
    this.initialEnded.clear();
    this.logByDriver.clear();
    this.logByVehicle.clear();
    this.vehicleDriver.set(gen.vehicleDriver);
    this.driverVehicle.length = 0;
    for (const v of gen.driverVehicle) this.driverVehicle.push(v);

    for (const r of db.prepare('SELECT * FROM driver_patches').all() as unknown as PatchRow[]) {
      const p: Partial<DriverFields> = {};
      if (r.name !== null) p.name = r.name;
      if (r.phone !== null) p.phone = r.phone;
      if (r.fleet_idx !== null) p.fleetIdx = r.fleet_idx;
      if (r.status !== null) p.status = r.status;
      if (r.user_id !== null) {
        p.userId = r.user_id;
        this.byUser.set(r.user_id, r.driver_idx);
      }
      this.patches.set(r.driver_idx, p);
    }
    for (const r of db
      .prepare('SELECT * FROM drivers_created ORDER BY driver_idx')
      .all() as unknown as CreatedRow[]) {
      if (r.driver_idx !== gen.count + this.created.length)
        throw new Error(`drivers_created: unexpected driver index ${r.driver_idx}`);
      this.created.push({
        name: r.name,
        phone: r.phone,
        fleetIdx: r.fleet_idx,
        status: r.status,
        userId: r.user_id,
        createdAt: r.created_at,
      });
      this.driverVehicle.push(-1);
      if (r.user_id !== null) this.byUser.set(r.user_id, r.driver_idx);
    }
    for (const r of db.prepare('SELECT * FROM initial_assignment_ends').all() as unknown as {
      driver_idx: number;
      ended_at: number;
    }[]) {
      this.initialEnded.set(r.driver_idx, r.ended_at);
      const v = gen.driverVehicle[r.driver_idx] ?? -1;
      if (v >= 0) {
        if (this.vehicleDriver[v] === r.driver_idx) this.vehicleDriver[v] = -1;
        this.driverVehicle[r.driver_idx] = -1;
      }
    }
    const rows = db
      .prepare('SELECT id, driver_idx, vehicle_id, from_at, to_at, by FROM assignments ORDER BY seq')
      .all() as unknown as AssignmentRow[];
    for (const r of rows) {
      const i = this.sim.indexOf(r.vehicle_id);
      if (i < 0) continue;
      const a: Assignment = {
        id: r.id,
        driverId: gen.id(r.driver_idx),
        vehicleId: r.vehicle_id,
        from: r.from_at,
        to: r.to_at,
        by: r.by,
      };
      this.pushLog(a, r.driver_idx, i);
      if (r.to_at === null) {
        this.vehicleDriver[i] = r.driver_idx;
        this.driverVehicle[r.driver_idx] = i;
      }
    }
  }

  private pushLog(a: Assignment, d: number, i: number): void {
    const push = <K>(map: Map<K, Assignment[]>, key: K) => {
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    };
    push(this.logByDriver, d);
    push(this.logByVehicle, i);
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
    if (d >= this.gen.count) {
      const c = Object.assign(this.created[d - this.gen.count]!, p);
      this.stmt.updateCreated.run(c.name, c.phone, c.fleetIdx, c.status, c.userId, d);
    } else {
      const next = { ...this.patches.get(d), ...p };
      this.patches.set(d, next);
      this.stmt.patch.run(
        d,
        next.name ?? null,
        next.phone ?? null,
        next.fleetIdx ?? null,
        next.status ?? null,
        next.userId ?? null,
      );
    }
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
    const c: DriverFields = { ...input, userId: null, createdAt: this.clock.now() };
    const d = this.count;
    this.stmt.insertCreated.run(d, c.name, c.phone, c.fleetIdx, c.status, null, c.createdAt);
    this.created.push(c);
    this.driverVehicle.push(-1);
    return d;
  }

  update(
    d: number,
    p: { name?: string; phone?: string; fleetIdx?: number; status?: DriverStatus },
  ) {
    atomic(this.db, () => {
      this.patch(d, p);
      if (p.status === 'disabled') this.unassign(d);
    });
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
    return atomic(this.db, () => {
      this.unassign(d);
      const a: Assignment = {
        id: `asg-${randomUUID()}`,
        driverId: this.gen.id(d),
        vehicleId: this.sim.vehicleId(i),
        from: this.clock.now(),
        to: null,
        by,
      };
      this.stmt.insertAssignment.run(a.id, d, a.vehicleId, a.from, a.by);
      this.pushLog(a, d, i);
      this.vehicleDriver[i] = d;
      this.driverVehicle[d] = i;
      if (this.status(d) === 'off-duty') this.patch(d, { status: 'active' });
      this.onAssignment(a);
      return a;
    });
  }

  /** Ends driver `d`'s current assignment, if any; returns it. */
  unassign(d: number): Assignment | null {
    const a = this.current(d);
    if (!a) return null;
    return atomic(this.db, () => {
      const now = this.clock.now();
      if (a.id === `asg-${d}`) {
        this.initialEnded.set(d, now);
        this.stmt.endInitial.run(d, now);
      } else {
        a.to = now;
        this.stmt.closeAssignment.run(now, a.id);
      }
      const i = this.driverVehicle[d]!;
      this.vehicleDriver[i] = -1;
      this.driverVehicle[d] = -1;
      const closed = { ...a, to: now };
      this.onAssignment(closed);
      return closed;
    });
  }
}
