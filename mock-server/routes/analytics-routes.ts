import {
  ANALYTICS_MAX_DAYS,
  analyticsQuerySchema,
  driverScore,
  KPI_FIELDS,
  type AnalyticsQuery,
  type DriverKpis,
  type KpiField,
  type User,
} from '@shared/contract/index.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  authorize,
  parse,
  requireFleetInScope,
  requireVehicleInScope,
  type MockContext,
} from '../context.ts';
import {
  DAY_MS,
  istDate,
  istDay,
  istDayStart,
  K,
  KPI_COUNT,
  toKpis,
} from '../generator/history-sim.ts';
import { HttpError } from '../http-error.ts';
import { requireDriverInScope } from './driver-routes.ts';

const DEFAULT_DAYS = 30;
const KPI_SET = new Set<string>(KPI_FIELDS);

interface Window {
  from: number;
  to: number;
  days: number;
}

/** One stretch of history to aggregate: vehicle `i` over `[from, to)`. */
type Span = [i: number, from: number, to: number];

function windowOf(ctx: MockContext, q: AnalyticsQuery): Window {
  const now = ctx.clock.now();
  const to = Math.min(q.to ?? now, now);
  const from = q.from ?? to - DEFAULT_DAYS * DAY_MS;
  if (from >= to) throw new HttpError(422, 'validation_failed', 'from must be before to');
  if (to - from > ANALYTICS_MAX_DAYS * DAY_MS)
    throw new HttpError(
      422,
      'validation_failed',
      `The window may span at most ${ANALYTICS_MAX_DAYS} days`,
    );
  return { from, to, days: istDay(to - 1) - istDay(from) + 1 };
}

/** A driver's assignment stretches inside the window (optionally on one vehicle). */
function driverSpans(ctx: MockContext, d: number, w: Window, onlyVehicle = -1): Span[] {
  const spans: Span[] = [];
  for (const a of ctx.drivers.driverHistory(d)) {
    const i = ctx.sim.indexOf(a.vehicleId);
    if (onlyVehicle >= 0 && i !== onlyVehicle) continue;
    const from = Math.max(w.from, a.from);
    const to = Math.min(w.to, a.to ?? w.to);
    if (to > from) spans.push([i, from, to]);
  }
  return spans;
}

/**
 * The vehicles (or, with `driverId`, the driver's stretches) a query covers. `vehicleId` narrows
 * to one vehicle; `fleetId` to a subtree; default: the caller's whole scope.
 */
function selection(ctx: MockContext, user: User, q: AnalyticsQuery, w: Window) {
  const vehicle =
    q.vehicleId === undefined ? -1 : requireVehicleInScope(ctx, q.vehicleId, user.fleetIds);
  if (q.driverId !== undefined) {
    const d = requireDriverInScope(ctx, q.driverId, user.fleetIds);
    return { spans: driverSpans(ctx, d, w, vehicle) };
  }
  if (vehicle >= 0) return { vehicles: [vehicle] };
  const roots =
    q.fleetId === undefined
      ? user.fleetIds
      : [requireFleetInScope(ctx, q.fleetId, user.fleetIds).id];
  const mask = ctx.tree.scopeMask(roots);
  const { sim } = ctx;
  const vehicles: number[] = [];
  for (let i = 0; i < sim.count; i++) if (mask[sim.fleet[i]!]) vehicles.push(i);
  return { vehicles };
}

function sortSpec(sort: string | undefined, fallback: string, allowScore: boolean) {
  const [key = fallback, dir] = (sort ?? fallback).split(':');
  if (!KPI_SET.has(key) && !(allowScore && key === 'score'))
    throw new HttpError(422, 'validation_failed', `Cannot sort by ${key}`);
  return { key, asc: dir === 'asc' };
}

/** F11 analytics over closed-form daily history (D-094): IST day buckets, ≤ 90 days. */
export async function analyticsRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { history, sim, drivers } = ctx;

  const prepare = (req: FastifyRequest) => {
    const { user } = authorize(ctx, req, 'analytics.view');
    const q = parse(analyticsQuerySchema, req.query);
    const w = windowOf(ctx, q);
    return { user, q, w };
  };

  app.get('/analytics/summary', async (req) => {
    const { user, q, w } = prepare(req);
    const sel = selection(ctx, user, q, w);
    const acc = new Float64Array(KPI_COUNT);
    let vehicleCount: number;
    if (sel.spans) {
      for (const [i, from, to] of sel.spans) history.addRange(i, from, to, acc);
      vehicleCount = new Set(sel.spans.map((s) => s[0])).size;
    } else {
      for (const i of sel.vehicles) history.addRange(i, w.from, w.to, acc);
      vehicleCount = sel.vehicles.length;
    }
    const kpis = toKpis(acc);
    const avail = kpis.uptimeMs + kpis.downtimeMs;
    const events = kpis.harshBrake + kpis.harshAccel + kpis.overspeed;
    return {
      ...w,
      vehicleCount,
      kpis,
      uptimePct: avail > 0 ? Math.round((kpis.uptimeMs / avail) * 1000) / 10 : 0,
      eventsPer100Km:
        kpis.distanceKm > 0 ? Math.round((events / kpis.distanceKm) * 100 * 100) / 100 : 0,
      score: driverScore(kpis),
    };
  });

  app.get('/analytics/series', async (req) => {
    const { user, q, w } = prepare(req);
    const sel = selection(ctx, user, q, w);
    const base = istDay(w.from);
    const acc = new Float64Array(w.days * KPI_COUNT);
    const spans: Span[] = sel.spans ?? sel.vehicles.map((i) => [i, w.from, w.to]);
    for (const [i, from, to] of spans) history.addRange(i, from, to, acc, base);
    return {
      ...w,
      points: Array.from({ length: w.days }, (_, k) => ({
        day: istDate(base + k),
        start: Math.max(w.from, istDayStart(base + k)),
        kpis: toKpis(acc, k * KPI_COUNT),
      })),
    };
  });

  app.get('/analytics/vehicles', async (req) => {
    const { user, q, w } = prepare(req);
    if (q.driverId !== undefined)
      throw new HttpError(422, 'validation_failed', 'Use /analytics/drivers for driverId');
    const { vehicles } = selection(ctx, user, q, w);
    const { key, asc } = sortSpec(q.sort, 'distanceKm', false);
    const slot = K[key as KpiField];
    const acc = new Float64Array(KPI_COUNT);
    const keys = new Float64Array(vehicles!.length);
    vehicles!.forEach((i, n) => {
      acc.fill(0);
      history.addRange(i, w.from, w.to, acc);
      keys[n] = acc[slot]!;
    });
    const order = [...vehicles!.keys()].sort((a, b) =>
      asc ? keys[a]! - keys[b]! : keys[b]! - keys[a]!,
    );
    const items = order.slice(0, q.limit).map((n) => {
      const i = vehicles![n]!;
      acc.fill(0);
      history.addRange(i, w.from, w.to, acc);
      return {
        vehicleId: sim.vehicleId(i),
        regno: sim.regno(i),
        fleetId: sim.fleetId(i),
        kpis: toKpis(acc),
      };
    });
    return { ...w, total: vehicles!.length, items };
  });

  app.get('/analytics/drivers', async (req) => {
    const { user, q, w } = prepare(req);
    const { key, asc } = sortSpec(q.sort, 'score', true);
    const vehicle =
      q.vehicleId === undefined ? -1 : requireVehicleInScope(ctx, q.vehicleId, user.fleetIds);
    let candidates: number[];
    if (q.driverId !== undefined)
      candidates = [requireDriverInScope(ctx, q.driverId, user.fleetIds)];
    else {
      const roots =
        q.fleetId === undefined
          ? user.fleetIds
          : [requireFleetInScope(ctx, q.fleetId, user.fleetIds).id];
      const mask = ctx.tree.scopeMask(roots);
      candidates = [];
      for (let d = 0; d < drivers.count; d++) if (mask[drivers.fleetIdx(d)]) candidates.push(d);
    }
    const rows: DriverKpis[] = [];
    const acc = new Float64Array(KPI_COUNT);
    for (const d of candidates) {
      const spans = driverSpans(ctx, d, w, vehicle);
      if (vehicle >= 0 && spans.length === 0) continue;
      acc.fill(0);
      let vehicleDays = 0;
      for (const [i, from, to] of spans) {
        history.addRange(i, from, to, acc);
        vehicleDays += (to - from) / DAY_MS;
      }
      const kpis = toKpis(acc);
      rows.push({
        driverId: drivers.gen.id(d),
        name: drivers.name(d),
        fleetId: drivers.fleetId(d),
        kpis,
        vehicleDays: Math.round(vehicleDays * 100) / 100,
        score: driverScore(kpis),
      });
    }
    const value = (r: DriverKpis) => (key === 'score' ? r.score : r.kpis[key as KpiField]);
    rows.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      return asc ? va - vb : vb - va;
    });
    return { ...w, total: rows.length, items: rows.slice(0, q.limit) };
  });
}
