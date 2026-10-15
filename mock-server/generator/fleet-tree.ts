import { MAX_FLEET_DEPTH, type Fleet } from '@shared/contract/index.ts';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { atomic } from '../db/database.ts';
import { HttpError } from '../http-error.ts';
import { REGIONS } from './catalogue.ts';

export interface FleetNode {
  idx: number;
  id: string;
  parent: number;
  name: string;
  depth: number;
  /** Index of the city (0..19) this node belongs to, or -1 for org/region. */
  city: number;
  region: number;
}

const HUBS_PER_CITY = 3;
const TEAMS_PER_HUB = 2;

interface FleetRow {
  idx: number;
  id: string;
  parent_idx: number;
  name: string;
  depth: number;
  city: number;
  region: number;
}

/** Vehicle placement the tree needs to rebuild `direct[]` on hydrate (a `VehicleSim`). */
export interface FleetPlacement {
  readonly count: number;
  readonly fleet: Uint32Array;
  indexOf(vehicleId: string): number;
  restoreSeedPlacement(): void;
  moveTo(i: number, fleetIdx: number, record?: boolean): void;
}

/**
 * Fleet tree. Nodes are addressed by a stable index; deleted slots become `null`. Built from the
 * seeded layout; once `attach`ed to the database (F22, D-139) every node change and every vehicle
 * move is written through, and `hydrate` replaces the nodes with the stored ones.
 */
export class FleetTree {
  readonly nodes: (FleetNode | null)[] = [];
  readonly byId = new Map<string, FleetNode>();
  /** Fleet indices per depth in the seeded tree (used to place vehicles). */
  readonly seededByDepth: number[][] = [[], [], [], [], [], []];
  /** Direct vehicle count per fleet index. */
  direct: number[] = [];
  /** Bumped on every structural change so scope caches can be rebuilt. */
  version = 0;
  private db?: DatabaseSync;
  private stmt?: { upsert: StatementSync; remove: StatementSync; move: StatementSync };

  constructor() {
    const root = this.add(-1, 'Acme Mobility', -1, -1);
    REGIONS.forEach((region, r) => {
      const reg = this.add(root.idx, region.name, -1, r);
      region.cities.forEach((city, ci) => {
        const cityIdx = r * region.cities.length + ci;
        const cn = this.add(reg.idx, city.name, cityIdx, r);
        for (let h = 1; h <= HUBS_PER_CITY; h++) {
          const hub = this.add(cn.idx, `${city.name} Hub ${h}`, cityIdx, r);
          for (let t = 0; t < TEAMS_PER_HUB; t++) {
            this.add(hub.idx, `${hub.name} · Team ${String.fromCharCode(65 + t)}`, cityIdx, r);
          }
        }
      });
    });
    for (const n of this.nodes) if (n) this.seededByDepth[n.depth]!.push(n.idx);
  }

  /** Writes every later node change and vehicle move to `db`. */
  attach(db: DatabaseSync): void {
    this.db = db;
    this.stmt = {
      upsert: db.prepare(
        `INSERT INTO fleets (idx, id, parent_idx, name, depth, city, region) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (idx) DO UPDATE SET id = excluded.id, parent_idx = excluded.parent_idx,
           name = excluded.name, depth = excluded.depth, city = excluded.city, region = excluded.region`,
      ),
      remove: db.prepare('DELETE FROM fleets WHERE idx = ?'),
      move: db.prepare(
        `INSERT INTO vehicle_fleet (vehicle_id, fleet_idx) VALUES (?, ?)
         ON CONFLICT (vehicle_id) DO UPDATE SET fleet_idx = excluded.fleet_idx`,
      ),
    };
  }

  private save(n: FleetNode): void {
    this.stmt?.upsert.run(n.idx, n.id, n.parent, n.name, n.depth, n.city, n.region);
  }

  /** Persists a vehicle move (called by `VehicleSim.moveTo`). */
  recordMove(vehicleId: string, fleetIdx: number): void {
    this.stmt?.move.run(vehicleId, fleetIdx);
  }

  /**
   * Replaces the nodes with the stored ones, puts every vehicle back on its seeded fleet, then
   * applies the stored moves (silently) and rebuilds `direct[]` (F22 §4).
   */
  hydrate(sim: FleetPlacement, warn: (msg: string) => void = () => {}): void {
    const db = this.db!;
    const rows = db.prepare('SELECT * FROM fleets ORDER BY idx').all() as unknown as FleetRow[];
    this.nodes.length = 0;
    this.byId.clear();
    for (const r of rows) {
      while (this.nodes.length < r.idx) this.nodes.push(null);
      const node: FleetNode = {
        idx: r.idx,
        id: r.id,
        parent: r.parent_idx,
        name: r.name,
        depth: r.depth,
        city: r.city,
        region: r.region,
      };
      this.nodes.push(node);
      this.byId.set(node.id, node);
    }
    // Deleted seeded fleets keep their slot, so new fleets never reuse a seeded id.
    const seeded = this.seededByDepth.reduce((n, l) => n + l.length, 0);
    while (this.nodes.length < seeded) this.nodes.push(null);
    sim.restoreSeedPlacement();
    this.direct = new Array<number>(this.nodes.length).fill(0);
    for (let i = 0; i < sim.count; i++) this.direct[sim.fleet[i]!]!++;
    const moves = db
      .prepare('SELECT vehicle_id, fleet_idx FROM vehicle_fleet')
      .all() as unknown as { vehicle_id: string; fleet_idx: number }[];
    for (const m of moves) {
      const i = sim.indexOf(m.vehicle_id);
      if (i < 0 || !this.nodes[m.fleet_idx]) {
        warn(`skipping stored move of unknown vehicle ${m.vehicle_id} → fleet ${m.fleet_idx}`);
        continue;
      }
      sim.moveTo(i, m.fleet_idx, false);
    }
    this.version++;
  }

  private add(parent: number, name: string, city: number, region: number): FleetNode {
    const idx = this.nodes.length;
    const depth = parent < 0 ? 1 : this.node(parent).depth + 1;
    const node: FleetNode = { idx, id: `f${idx}`, parent, name, depth, city, region };
    this.nodes.push(node);
    this.byId.set(node.id, node);
    this.direct.push(0);
    this.version++;
    return node;
  }

  private persist(fn: () => void): void {
    if (this.db) atomic(this.db, fn);
  }

  node(idx: number): FleetNode {
    const n = this.nodes[idx];
    if (!n) throw new Error(`fleet index ${idx} missing`);
    return n;
  }

  get(id: string): FleetNode | undefined {
    return this.byId.get(id);
  }

  require(id: string): FleetNode {
    const n = this.byId.get(id);
    if (!n) throw new HttpError(404, 'not_found', `Fleet ${id} not found`);
    return n;
  }

  get rootId(): string {
    return this.node(0).id;
  }

  isDescendant(idx: number, ancestor: number): boolean {
    for (let i = idx; i >= 0; i = this.node(i).parent) if (i === ancestor) return true;
    return false;
  }

  /** `allowed[idx] === 1` when fleet `idx` lies in any of the given subtrees. */
  scopeMask(rootIds: readonly string[]): Uint8Array {
    const roots = new Set(rootIds.map((id) => this.byId.get(id)?.idx ?? -2));
    const mask = new Uint8Array(this.nodes.length);
    for (const n of this.nodes) {
      if (!n) continue;
      for (let i = n.idx; i >= 0; i = this.node(i).parent) {
        if (roots.has(i)) {
          mask[n.idx] = 1;
          break;
        }
      }
    }
    return mask;
  }

  inScope(fleetId: string, rootIds: readonly string[]): boolean {
    const n = this.byId.get(fleetId);
    return (
      !!n &&
      rootIds.some((r) => {
        const root = this.byId.get(r);
        return !!root && this.isDescendant(n.idx, root.idx);
      })
    );
  }

  private subtreeHeight(idx: number): number {
    let h = 0;
    for (const n of this.nodes) {
      if (n && this.isDescendant(n.idx, idx)) h = Math.max(h, n.depth - this.node(idx).depth);
    }
    return h;
  }

  create(parentId: string, name: string): FleetNode {
    const parent = this.require(parentId);
    if (parent.depth >= MAX_FLEET_DEPTH) {
      throw new HttpError(
        422,
        'max_depth',
        `Fleets can be nested at most ${MAX_FLEET_DEPTH} levels deep`,
      );
    }
    const node = this.add(parent.idx, name, parent.city, parent.region);
    this.save(node);
    return node;
  }

  update(id: string, patch: { name?: string; parentId?: string }): FleetNode {
    const node = this.require(id);
    if (patch.parentId !== undefined && patch.parentId !== this.nodes[node.parent]?.id) {
      const parent = this.require(patch.parentId);
      if (node.parent < 0)
        throw new HttpError(422, 'validation_failed', 'The root fleet cannot be moved');
      if (this.isDescendant(parent.idx, node.idx)) {
        throw new HttpError(
          422,
          'validation_failed',
          'A fleet cannot be moved into its own subtree',
        );
      }
      if (parent.depth + 1 + this.subtreeHeight(node.idx) > MAX_FLEET_DEPTH) {
        throw new HttpError(
          422,
          'max_depth',
          `Fleets can be nested at most ${MAX_FLEET_DEPTH} levels deep`,
        );
      }
      const shift = parent.depth + 1 - node.depth;
      const moved = this.nodes.filter(
        (n): n is FleetNode => !!n && this.isDescendant(n.idx, node.idx),
      );
      for (const n of moved) n.depth += shift;
      node.parent = parent.idx;
      this.version++;
      if (patch.name !== undefined) node.name = patch.name;
      this.persist(() => moved.forEach((n) => this.save(n)));
      return node;
    }
    if (patch.name !== undefined) node.name = patch.name;
    this.save(node);
    return node;
  }

  remove(id: string): void {
    const node = this.require(id);
    if (node.parent < 0) throw new HttpError(409, 'conflict', 'The root fleet cannot be deleted');
    if (this.direct[node.idx]! > 0)
      throw new HttpError(409, 'conflict', 'Fleet still has vehicles');
    if (this.nodes.some((n) => n?.parent === node.idx)) {
      throw new HttpError(409, 'conflict', 'Fleet still has child fleets');
    }
    this.nodes[node.idx] = null;
    this.byId.delete(id);
    this.version++;
    this.stmt?.remove.run(node.idx);
  }

  /** Flat list of the fleets inside the given subtrees, with subtree vehicle counts. */
  list(rootIds: readonly string[]): Fleet[] {
    const total = new Array<number>(this.nodes.length).fill(0);
    for (const n of this.nodes) {
      if (!n) continue;
      for (let i = n.idx; i >= 0; i = this.node(i).parent) total[i]! += this.direct[n.idx]!;
    }
    const mask = this.scopeMask(rootIds);
    const out: Fleet[] = [];
    for (const n of this.nodes) {
      if (!n || !mask[n.idx]) continue;
      out.push({
        id: n.id,
        parentId: n.parent < 0 ? null : this.node(n.parent).id,
        name: n.name,
        depth: n.depth,
        vehicleCount: total[n.idx]!,
      });
    }
    return out;
  }
}
