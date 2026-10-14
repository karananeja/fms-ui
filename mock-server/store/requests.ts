import {
  TERMINAL_REQUEST_STATUSES,
  type DriverRequest,
  type FleetSettings,
  type GeoPoint,
  type NotificationKind,
  type NotificationSeverity,
  type ReplacementCandidate,
  type RequestAction,
  type RequestStatus,
  type RequestType,
  type BreakdownReason,
} from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { MODELS } from '../generator/catalogue.ts';
import { HttpError } from '../http-error.ts';
import type { Audience } from './notifications.ts';

/** Replacement eligibility (F11 §2). */
export const REPLACEMENT_MIN_SOC = 40;
export const REPLACEMENT_MIN_RANGE_KM = 60;
export const SUGGESTION_LIMIT = 5;

const TERMINAL = new Set<RequestStatus>(TERMINAL_REQUEST_STATUSES);
const REPLACEMENT_OPEN: RequestStatus[] = ['open', 'waiting', 'suggested', 'approved'];

/** Staff actions per type: allowed source statuses and the target (F11 §2 status flows). */
const FLOWS: Record<
  RequestType,
  Partial<Record<RequestAction, { from: RequestStatus[]; to: RequestStatus }>>
> = {
  breakdown: {
    acknowledge: { from: ['open'], to: 'acknowledged' },
    resolve: { from: ['acknowledged'], to: 'resolved' },
    close: { from: ['acknowledged'], to: 'closed' },
  },
  rsa: {
    acknowledge: { from: ['open'], to: 'acknowledged' },
    dispatch: { from: ['acknowledged'], to: 'dispatched' },
    resolve: { from: ['dispatched'], to: 'resolved' },
    close: { from: ['dispatched'], to: 'closed' },
  },
  replacement: {
    approve: { from: ['suggested'], to: 'approved' },
    override: { from: ['open', 'waiting', 'suggested'], to: 'approved' },
    reject: { from: REPLACEMENT_OPEN, to: 'rejected' },
    close: { from: REPLACEMENT_OPEN, to: 'closed' },
  },
};

const TYPE_LABEL: Record<RequestType, string> = {
  breakdown: 'Breakdown',
  replacement: 'Replacement',
  rsa: 'Roadside assistance',
};
const REASON_LABEL: Record<BreakdownReason, string> = {
  'no-gps-device': 'GPS device not working',
  'battery-charging': 'Battery or charging problem',
  tyre: 'Tyre problem',
  accident: 'Accident',
  mechanical: 'Mechanical fault',
  other: 'Other problem',
};

const toRad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Driver requests, their timelines, fleet settings and the replacement engine (memory only). */
export class Requests {
  private readonly items: DriverRequest[] = [];
  private readonly byId = new Map<string, DriverRequest>();
  /** `autoAssignReplacement` overrides by fleet index (inherited down the tree). */
  private readonly autoAssign = new Map<number, boolean>();
  private seq = 0;
  private reevaluating = false;

  constructor(private readonly ctx: MockContext) {}

  get all(): readonly DriverRequest[] {
    return this.items;
  }

  /** `404` if unknown. */
  get(id: string): DriverRequest {
    const r = this.byId.get(id);
    if (!r) throw new HttpError(404, 'not_found', `Request ${id} not found`);
    return r;
  }

  isOpen(r: DriverRequest): boolean {
    return !TERMINAL.has(r.status);
  }

  /** Vehicles with any open request. */
  private openVehicles(): Set<number> {
    const set = new Set<number>();
    for (const r of this.items) if (this.isOpen(r)) set.add(this.ctx.sim.indexOf(r.vehicleId));
    return set;
  }

  openForDriver(driverId: string): DriverRequest[] {
    return this.items.filter((r) => r.driverId === driverId && this.isOpen(r));
  }

  /** The open breakdown on a vehicle, if any (no-GPS insight). */
  openBreakdown(vehicleId: string): DriverRequest | undefined {
    return this.items.find(
      (r) => r.vehicleId === vehicleId && r.type === 'breakdown' && this.isOpen(r),
    );
  }

  audience(r: DriverRequest): Audience {
    return {
      fleetId: r.fleetId,
      staff: ['requests.manage'],
      driver: this.ctx.drivers.indexOf(r.driverId),
    };
  }

  // ---- fleet settings ----

  settings(fleetIdx: number): FleetSettings {
    const { tree } = this.ctx;
    let value = false;
    for (let k = fleetIdx; k >= 0; k = tree.node(k).parent) {
      const v = this.autoAssign.get(k);
      if (v !== undefined) {
        value = v;
        break;
      }
    }
    return {
      fleetId: tree.node(fleetIdx).id,
      autoAssignReplacement: value,
      overridden: this.autoAssign.has(fleetIdx),
    };
  }

  setAutoAssign(fleetIdx: number, value: boolean | null): FleetSettings {
    if (value === null) this.autoAssign.delete(fleetIdx);
    else this.autoAssign.set(fleetIdx, value);
    this.reevaluate();
    return this.settings(fleetIdx);
  }

  // ---- lifecycle ----

  /** `POST /requests` for driver `d`'s current vehicle. */
  create(
    d: number,
    input: { type: RequestType; reason?: BreakdownReason; note: string; location?: GeoPoint },
    by: string,
  ): DriverRequest {
    const { drivers, sim, clock } = this.ctx;
    const i = drivers.vehicleOf(d);
    if (i < 0) throw new HttpError(409, 'conflict', 'You have no vehicle assigned');
    const driverId = drivers.gen.id(d);
    if (this.items.some((r) => r.driverId === driverId && r.type === input.type && this.isOpen(r)))
      throw new HttpError(409, 'conflict', `You already have an open ${input.type} request`);
    const now = clock.now();
    const s = sim.state(i, now);
    const location =
      input.location ?? (s.lat === 0 && s.lng === 0 ? null : { lat: s.lat, lng: s.lng });
    const r: DriverRequest = {
      id: `req-${++this.seq}`,
      type: input.type,
      vehicleId: sim.vehicleId(i),
      driverId,
      fleetId: sim.fleetId(i),
      status: 'open',
      ...(input.reason ? { reason: input.reason } : {}),
      note: input.note,
      location,
      createdAt: now,
      updatedAt: now,
      timeline: [{ at: now, status: 'open', by, ...(input.note ? { note: input.note } : {}) }],
      ...(input.type === 'replacement' ? { replacement: {} } : {}),
    };
    this.items.push(r);
    this.byId.set(r.id, r);
    const what = input.reason ? REASON_LABEL[input.reason] : input.note || TYPE_LABEL[r.type];
    this.notify(r, 'request-created', input.type === 'replacement' ? 'warning' : 'critical', {
      title: `${TYPE_LABEL[r.type]} request from ${drivers.name(d)}`,
      body: `${sim.regno(i)}: ${what}`,
    });
    if (r.type === 'replacement') this.advance(r);
    else this.publish(r);
    return r;
  }

  /** A staff action (`409` for an invalid transition). */
  act(
    r: DriverRequest,
    body: {
      action: RequestAction;
      note?: string;
      vehicleId?: string;
      assignee?: string;
      etaMinutes?: number;
    },
    by: string,
    scope: readonly string[],
  ): DriverRequest {
    const flow = FLOWS[r.type][body.action];
    if (!flow || !flow.from.includes(r.status)) {
      throw new HttpError(
        409,
        'invalid_transition',
        `Cannot ${body.action} a ${r.type} request that is ${r.status}`,
      );
    }
    if (body.action === 'dispatch') {
      if (!body.assignee || !body.etaMinutes)
        throw new HttpError(422, 'validation_failed', 'dispatch needs assignee and etaMinutes');
      r.rsa = { assignee: body.assignee, etaMinutes: body.etaMinutes };
    }
    if (body.action === 'approve' || body.action === 'override') {
      const vehicleId =
        body.vehicleId ??
        (body.action === 'approve' ? r.replacement?.suggestedVehicleId : undefined);
      if (!vehicleId)
        throw new HttpError(422, 'validation_failed', `${body.action} needs vehicleId`);
      const i = this.requireAvailable(r, vehicleId, scope, body.action === 'approve');
      this.step(r, 'approved', by, body.note);
      this.assignReplacement(r, i, by);
    } else this.step(r, flow.to, by, body.note);
    this.notifyUpdate(r);
    this.publish(r);
    if (!this.isOpen(r)) this.reevaluate();
    return r;
  }

  /** Vehicle index for approve/override: in scope, free, and (approve) still eligible. */
  private requireAvailable(
    r: DriverRequest,
    vehicleId: string,
    scope: readonly string[],
    eligibleOnly: boolean,
  ): number {
    const { sim, tree, drivers } = this.ctx;
    const i = sim.indexOf(vehicleId);
    if (i < 0) throw new HttpError(404, 'not_found', `Vehicle ${vehicleId} not found`);
    if (!tree.inScope(sim.fleetId(i), scope))
      throw new HttpError(403, 'forbidden', 'Vehicle is outside your scope');
    if (vehicleId === r.vehicleId || drivers.driverOf(i) >= 0 || this.openVehicles().has(i))
      throw new HttpError(409, 'conflict', 'Vehicle is not available');
    if (eligibleOnly && !this.candidate(r, i, this.ctx.clock.now()))
      throw new HttpError(409, 'conflict', 'Vehicle no longer qualifies as a replacement');
    return i;
  }

  private step(r: DriverRequest, status: RequestStatus, by: string, note?: string): void {
    const at = this.ctx.clock.now();
    r.status = status;
    r.updatedAt = at;
    r.timeline.push({ at, status, by, ...(note ? { note } : {}) });
  }

  private assignReplacement(r: DriverRequest, i: number, by: string): void {
    const { drivers, sim } = this.ctx;
    const vehicleId = sim.vehicleId(i);
    r.replacement = { ...r.replacement, assignedVehicleId: vehicleId };
    this.step(r, 'assigned', by);
    drivers.assign(drivers.indexOf(r.driverId), i, by);
  }

  /** Replacement engine: suggest (or auto-assign) the best candidate, else wait. */
  private advance(r: DriverRequest): void {
    const best = this.suggestions(r, 1)[0];
    const auto = this.settings(this.ctx.tree.require(r.fleetId).idx).autoAssignReplacement;
    if (!best) {
      if (r.status === 'open') {
        this.step(r, 'waiting', 'system', 'No replacement vehicle qualifies yet');
        this.notify(r, 'replacement-waiting', 'warning', {
          title: 'Replacement is waiting for a vehicle',
          body: `No idle vehicle in the fleet qualifies for ${this.ctx.sim.regno(this.ctx.sim.indexOf(r.vehicleId))} yet.`,
        });
      }
    } else if (auto) {
      this.assignReplacement(r, this.ctx.sim.indexOf(best.vehicleId), 'system');
      this.notifyUpdate(r);
    } else {
      r.replacement = { ...r.replacement, suggestedVehicleId: best.vehicleId };
      this.step(r, 'suggested', 'system', `Suggested ${best.regno}`);
      this.notifyUpdate(r);
    }
    this.publish(r);
  }

  /** Re-runs the engine for waiting replacements (job tick, freed vehicles, settings changes). */
  reevaluate(): void {
    if (this.reevaluating) return;
    this.reevaluating = true;
    try {
      for (const r of this.items)
        if (r.type === 'replacement' && r.status === 'waiting') this.advance(r);
    } finally {
      this.reevaluating = false;
    }
  }

  // ---- candidates ----

  private origin(r: DriverRequest, now: number): GeoPoint | null {
    if (r.location) return r.location;
    const s = this.ctx.sim.state(this.ctx.sim.indexOf(r.vehicleId), now);
    return s.lat === 0 && s.lng === 0 ? null : { lat: s.lat, lng: s.lng };
  }

  /** Candidate data if vehicle `i` qualifies on live state (fleet, status, SOC, range); else null. */
  private candidate(r: DriverRequest, i: number, now: number, origin = this.origin(r, now)) {
    const { sim } = this.ctx;
    if (sim.fleetId(i) !== r.fleetId) return null;
    const status = sim.status(i, now);
    if (status !== 'stopped' && status !== 'charging') return null;
    const s = sim.state(i, now);
    const ev = MODELS[sim.model[i]!]!.fuelType === 'EV';
    if ((ev && s.soc < REPLACEMENT_MIN_SOC) || s.dte < REPLACEMENT_MIN_RANGE_KM) return null;
    const distanceKm = origin ? haversineKm(origin, { lat: s.lat, lng: s.lng }) : 0;
    return {
      vehicleId: sim.vehicleId(i),
      regno: sim.regno(i),
      status,
      distanceKm: Math.round(distanceKm * 100) / 100,
      soc: ev ? s.soc : null,
      rangeKm: s.dte,
    } satisfies ReplacementCandidate;
  }

  /**
   * Idle vehicles in the request's fleet with no driver and no open request, `stopped` or
   * `charging`, SOC ≥ 40 % (EVs) and range ≥ 60 km; nearest first.
   */
  suggestions(r: DriverRequest, limit = SUGGESTION_LIMIT): ReplacementCandidate[] {
    const { sim, tree, drivers, clock } = this.ctx;
    const fleet = tree.get(r.fleetId);
    if (!fleet) return [];
    const now = clock.now();
    const origin = this.origin(r, now);
    const open = this.openVehicles();
    const out: ReplacementCandidate[] = [];
    for (let i = 0; i < sim.count; i++) {
      if (sim.fleet[i] !== fleet.idx || drivers.driverOf(i) >= 0 || open.has(i)) continue;
      const c = this.candidate(r, i, now, origin);
      if (c) out.push(c);
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
  }

  // ---- fan-out ----

  private publish(r: DriverRequest): void {
    this.ctx.hub?.publish('request', r, this.audience(r));
  }

  private notify(
    r: DriverRequest,
    kind: NotificationKind,
    severity: NotificationSeverity,
    text: { title: string; body: string },
  ): void {
    const audience = this.audience(r);
    this.ctx.notifications?.add(
      { kind, severity, ...text, fleetId: r.fleetId, vehicleId: r.vehicleId, requestId: r.id },
      kind === 'request-created' ? { ...audience, driver: -1 } : audience,
    );
  }

  /** `request-updated` for the requester and staff after a status change. */
  private notifyUpdate(r: DriverRequest): void {
    this.notify(r, 'request-updated', 'info', {
      title: `${TYPE_LABEL[r.type]} request ${r.status}`,
      body: `${this.ctx.sim.regno(this.ctx.sim.indexOf(r.vehicleId))}: ${r.timeline.at(-1)!.note ?? `now ${r.status}`}`,
    });
  }
}
