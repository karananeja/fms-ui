// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../build-server.ts';
import { HttpError } from '../http-error.ts';
import { REPLACEMENT_MIN_RANGE_KM, REPLACEMENT_MIN_SOC } from './requests.ts';

const app = buildServer({ vehicles: 3000 });
const ctx = app.mock;
const { drivers, requests, sim, tree } = ctx;
afterAll(() => app.close());

const ROOT = [tree.rootId];
/** Drivers with a vehicle that has no open request, in index order (fresh per test). */
let next = 0;
const driverWithVehicle = () => {
  while (next < drivers.count) {
    const d = next++;
    const i = drivers.vehicleOf(d);
    if (i >= 0 && !requests.all.some((r) => r.vehicleId === sim.vehicleId(i))) return d;
  }
  throw new Error('no free driver with a vehicle left');
};
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
};
const statuses = (r: { timeline: { status: string }[] }) => r.timeline.map((t) => t.status);

beforeEach(() => {
  for (const f of tree.byId.values()) requests.setAutoAssign(f.idx, null);
});

describe('F11-T2 request state machines', () => {
  it('breakdown: open → acknowledged → resolved, timeline appended, invalid → 409', () => {
    const d = driverWithVehicle();
    const r = requests.create(d, { type: 'breakdown', reason: 'tyre', note: 'flat' }, 'u-driver');
    expect(r.status).toBe('open');
    expect(status(() => requests.act(r, { action: 'resolve' }, 'u-ops', ROOT))).toBe(409);
    expect(status(() => requests.act(r, { action: 'dispatch' }, 'u-ops', ROOT))).toBe(409);
    requests.act(r, { action: 'acknowledge' }, 'u-ops', ROOT);
    requests.act(r, { action: 'resolve', note: 'fixed' }, 'u-ops', ROOT);
    expect(statuses(r)).toEqual(['open', 'acknowledged', 'resolved']);
    expect(r.timeline.at(-1)).toMatchObject({ by: 'u-ops', note: 'fixed' });
    expect(status(() => requests.act(r, { action: 'close' }, 'u-ops', ROOT))).toBe(409);
  });

  it('rsa: dispatch needs assignee + ETA (422), then dispatched → resolved', () => {
    const d = driverWithVehicle();
    const r = requests.create(d, { type: 'rsa', note: '' }, 'u-driver');
    requests.act(r, { action: 'acknowledge' }, 'u-ops', ROOT);
    expect(status(() => requests.act(r, { action: 'dispatch' }, 'u-ops', ROOT))).toBe(422);
    requests.act(r, { action: 'dispatch', assignee: 'Suresh', etaMinutes: 30 }, 'u-ops', ROOT);
    expect(r.rsa).toEqual({ assignee: 'Suresh', etaMinutes: 30 });
    requests.act(r, { action: 'resolve' }, 'u-ops', ROOT);
    expect(statuses(r)).toEqual(['open', 'acknowledged', 'dispatched', 'resolved']);
  });

  it('rejects a second open request of the same type, allows it once closed', () => {
    const d = driverWithVehicle();
    const r = requests.create(d, { type: 'breakdown', reason: 'other', note: '' }, 'u-driver');
    expect(
      status(() => requests.create(d, { type: 'breakdown', reason: 'tyre', note: '' }, 'x')),
    ).toBe(409);
    requests.act(r, { action: 'acknowledge' }, 'u-ops', ROOT);
    requests.act(r, { action: 'close' }, 'u-ops', ROOT);
    expect(requests.create(d, { type: 'breakdown', reason: 'tyre', note: '' }, 'x').status).toBe(
      'open',
    );
  });

  it('a driver without a vehicle cannot create a request (409)', () => {
    const spare = drivers.gen.assignedCount;
    expect(drivers.vehicleOf(spare)).toBe(-1);
    expect(status(() => requests.create(spare, { type: 'rsa', note: '' }, 'x'))).toBe(409);
  });
});

describe('F11-T3 replacement engine', () => {
  it('suggests eligible, unassigned vehicles in the same fleet, nearest first; approve moves the assignment', () => {
    const d = driverWithVehicle();
    const old = drivers.vehicleOf(d);
    const r = requests.create(d, { type: 'replacement', note: '' }, 'u-driver');
    const list = requests.suggestions(r);
    expect(list.length).toBeGreaterThan(0);
    for (let k = 1; k < list.length; k++)
      expect(list[k]!.distanceKm).toBeGreaterThanOrEqual(list[k - 1]!.distanceKm);
    for (const c of list) {
      const i = sim.indexOf(c.vehicleId);
      expect(sim.fleetId(i)).toBe(r.fleetId);
      expect(drivers.driverOf(i)).toBe(-1);
      expect(['stopped', 'charging']).toContain(c.status);
      expect(c.rangeKm).toBeGreaterThanOrEqual(REPLACEMENT_MIN_RANGE_KM);
      if (c.soc !== null) expect(c.soc).toBeGreaterThanOrEqual(REPLACEMENT_MIN_SOC);
    }
    expect(r.status).toBe('suggested');
    expect(r.replacement?.suggestedVehicleId).toBe(list[0]!.vehicleId);

    requests.act(r, { action: 'approve' }, 'u-ops', ROOT);
    expect(r.status).toBe('assigned');
    const now = drivers.vehicleOf(d);
    expect(sim.vehicleId(now)).toBe(list[0]!.vehicleId);
    expect(drivers.driverOf(old)).toBe(-1);
    const history = drivers.driverHistory(d);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((a) => a.vehicleId === sim.vehicleId(old) && a.to !== null)).toBe(true);
  });

  it('waits when nothing qualifies, then suggests once a vehicle frees up', () => {
    const d = driverWithVehicle();
    const fleetIdx = drivers.fleetIdx(d);
    const probe = requests.create(d, { type: 'replacement', note: '' }, 'u-driver');
    // Occupy every candidate with a spare driver so nothing qualifies.
    requests.act(probe, { action: 'close' }, 'u-ops', ROOT);
    let spare = drivers.gen.assignedCount;
    const occupied: number[] = [];
    for (const c of requests.suggestions(probe, Infinity)) {
      while (drivers.vehicleOf(spare) >= 0 || drivers.fleetIdx(spare) < 0) spare++;
      drivers.assign(spare, sim.indexOf(c.vehicleId), 'test');
      occupied.push(spare++);
    }
    const r = requests.create(d, { type: 'replacement', note: '' }, 'u-driver');
    expect(r.status).toBe('waiting');
    expect(ctx.notifications.size).toBeGreaterThan(0);

    drivers.unassign(occupied[0]!);
    requests.reevaluate();
    expect(r.status).toBe('suggested');
    expect(statuses(r)).toEqual(['open', 'waiting', 'suggested']);
    expect(fleetIdx).toBe(drivers.fleetIdx(d));
  });

  it('auto-assign skips approval and records the system as the actor', () => {
    const d = driverWithVehicle();
    requests.setAutoAssign(drivers.fleetIdx(d), true);
    const r = requests.create(d, { type: 'replacement', note: '' }, 'u-driver');
    expect(r.status).toBe('assigned');
    expect(r.timeline.at(-1)).toMatchObject({ status: 'assigned', by: 'system' });
    expect(sim.vehicleId(drivers.vehicleOf(d))).toBe(r.replacement?.assignedVehicleId);
  });

  it('override rejects a vehicle that already has a driver (409) or is outside scope (403)', () => {
    const d = driverWithVehicle();
    const r = requests.create(d, { type: 'replacement', note: '' }, 'u-driver');
    const taken = drivers.vehicleOf(driverWithVehicle());
    const body = { action: 'override' as const, vehicleId: sim.vehicleId(taken) };
    expect(status(() => requests.act(r, body, 'u-ops', ROOT))).toBe(409);
    const elsewhere = [...tree.byId.values()].find(
      (f) => f.id !== tree.rootId && !tree.inScope(r.fleetId, [f.id]),
    )!;
    // Scope is checked before availability, so any vehicle of the request's fleet shows it.
    const scoped = { action: 'override' as const, vehicleId: r.vehicleId };
    expect(status(() => requests.act(r, scoped, 'u-ops', [elsewhere.id]))).toBe(403);
  });
});
