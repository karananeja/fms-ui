import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { ToolError } from '@anthropic-ai/sdk/lib/tools/ToolError';
import {
  ANALYTICS_MAX_DAYS,
  DRIVER_STATUSES,
  REPORT_KINDS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  type AnalyticsSeries,
  type AnalyticsSummary,
  type Driver,
  type DriverRequest,
  type Kpis,
  type NoGpsInsight,
} from '@shared/contract/index.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DAY_MS, istDay, istDayStart } from '../generator/history-sim.ts';
import {
  buildReport,
  formatIst,
  istDateOf,
  PDF_MAX_ROWS,
  REPORT_PERMISSION,
  reportFilename,
  STATUS_LABEL,
  toCsv,
  toPdf,
} from './reports.ts';
import {
  has,
  newTurnState,
  normRegno,
  notFound,
  notPermitted,
  resolveFleet,
  resolveVehicle,
  spec,
  ToolFailure,
  type ToolHost,
  type ToolSpec,
} from './tool-kit.ts';

import { DASHBOARD_SPECS } from './dashboard-tools.ts';

export { ToolFailure, type ToolHost } from './tool-kit.ts';

/**
 * F17 read-only tools (spec §3). Every tool runs as the signed-in user: REST routes are called
 * in-process with the user's session cookie (`host.api`, so the route guards apply unchanged);
 * where no route fits (live state, vehicle search for users without `fleets.manage`, driver search
 * for users without `drivers.manage`), the tool reads the same in-memory state behind the same
 * permission and scope checks the live-tracking / analytics routes use. Out-of-scope = not found.
 */

/** `GET` that maps 403 → not permitted, 404 → not found, other 4xx → invalid. */
async function get<T>(host: ToolHost, path: string, what: string): Promise<T> {
  const res = await host.api(path);
  if (res.status === 403) throw notPermitted(what);
  if (res.status === 404) throw notFound('That item');
  if (res.status >= 400) {
    const msg = (res.body as { error?: { message?: string } })?.error?.message;
    throw new ToolFailure(msg ?? `Request failed (${res.status})`);
  }
  return res.body as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const parseDay = (s: string, field: string) => {
  const m = DATE_RE.exec(s.trim());
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!Number.isFinite(ms)) throw new ToolFailure(`${field} must be a date like 2026-10-14.`);
  return Math.floor(ms / DAY_MS);
};

/** `[from, to)` in epoch ms from inclusive IST dates; default: the last 7 days up to now. */
export function windowOf(now: number, from?: string, to?: string) {
  const today = istDay(now);
  const toDay = to ? parseDay(to, 'to') : today;
  const fromDay = from ? parseDay(from, 'from') : toDay - 6;
  if (fromDay > toDay) throw new ToolFailure('from must not be after to.');
  if (toDay - fromDay + 1 > ANALYTICS_MAX_DAYS)
    throw new ToolFailure(`The range may span at most ${ANALYTICS_MAX_DAYS} days.`);
  const start = istDayStart(fromDay);
  if (start >= now) throw new ToolFailure('The range is in the future.');
  return { from: start, to: Math.min(istDayStart(toDay + 1), now) };
}

const fleetName = (host: ToolHost, id: string) => host.ctx.tree.get(id)?.name ?? id;

function addVehicle(host: ToolHost, i: number) {
  const { sim } = host.ctx;
  const id = sim.vehicleId(i);
  host.entities.set(`vehicle:${id}`, { kind: 'vehicle', id, label: sim.regno(i) });
}
function addDriver(host: ToolHost, id: string, name: string) {
  host.entities.set(`driver:${id}`, { kind: 'driver', id, label: name });
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const h = (ms: number) => round1(ms / 3_600_000);
function kpiView(k: Kpis) {
  const avail = k.uptimeMs + k.downtimeMs;
  return {
    distanceKm: round1(k.distanceKm),
    driveHours: h(k.driveMs),
    idleHours: h(k.idleMs),
    downtimeHours: h(k.downtimeMs),
    uptimePct: avail > 0 ? round1((k.uptimeMs / avail) * 100) : null,
    noGpsHours: h(k.noGpsMs),
    energyKwh: round1(k.energyKwh),
    chargeSessions: k.chargeSessions,
    breakdowns: k.breakdowns,
    harshBrake: k.harshBrake,
    harshAccel: k.harshAccel,
    overspeed: k.overspeed,
  };
}

function statusCounts(host: ToolHost, fleetId: string | undefined) {
  const { sim, tree, clock } = host.ctx;
  const mask = tree.scopeMask(fleetId ? [fleetId] : host.user.fleetIds);
  const now = clock.now();
  const counts: Partial<Record<VehicleStatus, number>> = {};
  let total = 0;
  for (let i = 0; i < sim.count; i++) {
    if (!mask[sim.fleet[i]!]) continue;
    const s = sim.status(i, now);
    counts[s] = (counts[s] ?? 0) + 1;
    total++;
  }
  return { total, byStatus: counts };
}

// ---- tool definitions ----

const optionalDate = (what: string) =>
  z.string().describe(`${what} as an IST date, YYYY-MM-DD (inclusive).`).optional();

const findVehicles = spec({
  name: 'find_vehicles',
  description:
    'Search the vehicles the user can see by regno/VIN/device id fragment, current status and/or fleet. Returns at most `limit` vehicles (default 20, max 50) with their status, fleet and last update, plus the total match count and counts by status.',
  schema: z.object({
    query: z.string().describe('Fragment of a regno, VIN, vehicle id or device id.').optional(),
    status: z.enum(VEHICLE_STATUSES).describe('Current derived status.').optional(),
    fleet: z.string().describe('Fleet name or id (includes its sub-fleets).').optional(),
    limit: z.number().int().describe('Max vehicles to list, 1–50 (default 20).').optional(),
  }),
  label: (i) => (i.query ? `Searching vehicles for ${i.query}…` : 'Searching vehicles…'),
  async run(host, input) {
    if (!has(host, 'live.view')) throw notPermitted('viewing live vehicle data');
    const { sim, tree, clock } = host.ctx;
    const fleetId = resolveFleet(host, input.fleet);
    const mask = tree.scopeMask(fleetId ? [fleetId] : host.user.fleetIds);
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));
    const q = input.query ? normRegno(input.query) : undefined;
    const now = clock.now();
    const byStatus: Partial<Record<VehicleStatus, number>> = {};
    const items: unknown[] = [];
    let total = 0;
    for (let i = 0; i < sim.count; i++) {
      if (!mask[sim.fleet[i]!]) continue;
      if (q) {
        const m = sim.meta(i);
        if (![m.regno, m.vin, m.vehicleId, m.deviceId].some((v) => normRegno(v).includes(q)))
          continue;
      }
      const status = sim.status(i, now);
      if (input.status && status !== input.status) continue;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      total++;
      if (items.length < limit) {
        const s = sim.state(i, now);
        items.push({
          regno: sim.regno(i),
          vehicleId: sim.vehicleId(i),
          status,
          fleet: tree.node(sim.fleet[i]!).name,
          lastUpdate: formatIst(s.utctime),
        });
        addVehicle(host, i);
      }
    }
    return {
      result: { total, shown: items.length, byStatus, items },
      summary: `${total} vehicle${total === 1 ? '' : 's'}`,
    };
  },
});

const getVehicle = spec({
  name: 'get_vehicle',
  description:
    "One vehicle's current state: status, location, speed, SOC, range, odometer, ignition, last GPS/CAN times, the assigned driver and, when it has no GPS, the likely cause. Give the regno (preferred) or the vehicleId.",
  schema: z.object({
    regno: z.string().describe('Registration number, e.g. MH12AB1234.').optional(),
    vehicleId: z.string().describe('Internal vehicle id.').optional(),
  }),
  label: (i) => `Looking up ${i.regno ?? i.vehicleId ?? 'vehicle'}…`,
  async run(host, input) {
    if (!has(host, 'live.view', 'vehicle.details.view'))
      throw notPermitted('viewing vehicle details');
    const i = resolveVehicle(host, input);
    const { sim, clock } = host.ctx;
    const now = clock.now();
    const meta = sim.meta(i);
    const status = sim.status(i, now);
    const s = { ...sim.state(i, now) };
    let driver: { id: string; name: string; phone: string } | null = null;
    let noGps: NoGpsInsight | null = null;
    if (has(host, 'vehicle.details.view')) {
      const d = await get<Driver | null>(
        host,
        `/api/vehicles/${encodeURIComponent(meta.vehicleId)}/driver`,
        'viewing the vehicle driver',
      );
      if (d) {
        driver = { id: d.id, name: d.name, phone: d.phone };
        addDriver(host, d.id, d.name);
      }
      if (status === 'no-gps' || status === 'non-comm') {
        const res = await host.api(
          `/api/vehicles/${encodeURIComponent(meta.vehicleId)}/no-gps-insight`,
        );
        if (res.status === 200) noGps = res.body as NoGpsInsight;
      }
    }
    addVehicle(host, i);
    const hasFix = !(s.lat === 0 && s.lng === 0);
    return {
      result: {
        regno: meta.regno,
        vehicleId: meta.vehicleId,
        fleet: fleetName(host, meta.fleetId),
        vehicle: `${meta.make} ${meta.model} ${meta.variant} (${meta.fuelType})`,
        status,
        statusLabel: STATUS_LABEL[status],
        speedKmh: Math.round(s.speed),
        socPct: Math.round(s.soc),
        rangeKm: Math.round(s.dte),
        odometerKm: Math.floor(s.odometer),
        ignition: s.ignstatus === 1 ? 'on' : 'off',
        location: hasFix ? { lat: s.lat, lng: s.lng } : null,
        lastUpdate: formatIst(s.utctime),
        lastGps: s.gpstime > 0 ? formatIst(s.gpstime) : null,
        lastCan: s.canutctime > 0 ? formatIst(s.canutctime) : null,
        driver,
        noGps: noGps && {
          since: formatIst(noGps.since),
          hours: h(noGps.durationMs),
          likelyCause: noGps.likelyCause,
          explanation: noGps.explanation,
        },
      },
      summary: `${meta.regno}: ${STATUS_LABEL[status]}`,
    };
  },
});

const vehicleHistory = spec({
  name: 'vehicle_history',
  description:
    "A vehicle's daily KPIs (distance, drive/idle/downtime hours, no-GPS hours, energy, breakdowns, harsh events) over a date range, with totals. Default range: the last 7 days.",
  schema: z.object({
    regno: z.string().describe('Registration number.'),
    from: optionalDate('Start date'),
    to: optionalDate('End date'),
  }),
  label: (i) => `Fetching history for ${i.regno}…`,
  async run(host, input) {
    if (!has(host, 'analytics.view')) throw notPermitted('viewing analytics');
    const i = resolveVehicle(host, { regno: input.regno });
    const w = windowOf(host.ctx.clock.now(), input.from, input.to);
    const vehicleId = host.ctx.sim.vehicleId(i);
    const series = await get<AnalyticsSeries>(
      host,
      `/api/analytics/series${qs({ vehicleId, from: w.from, to: w.to })}`,
      'viewing analytics',
    );
    const totals = await get<AnalyticsSummary>(
      host,
      `/api/analytics/summary${qs({ vehicleId, from: w.from, to: w.to })}`,
      'viewing analytics',
    );
    addVehicle(host, i);
    return {
      result: {
        regno: host.ctx.sim.regno(i),
        from: istDateOf(w.from),
        to: istDateOf(w.to - 1),
        totals: { ...kpiView(totals.kpis), score: totals.score },
        days: series.points.map((p) => ({ day: p.day, ...kpiView(p.kpis) })),
      },
      summary: `${series.points.length} days`,
    };
  },
});

function driverView(host: ToolHost, d: number) {
  const { drivers, sim } = host.ctx;
  const v = drivers.vehicleOf(d);
  const id = drivers.gen.id(d);
  addDriver(host, id, drivers.name(d));
  if (v >= 0) addVehicle(host, v);
  return {
    id,
    name: drivers.name(d),
    phone: drivers.phone(d),
    fleet: fleetName(host, drivers.fleetId(d)),
    status: drivers.status(d),
    currentVehicle: v >= 0 ? sim.regno(v) : null,
  };
}

/** Drivers in the user's scope (optionally a subtree) that pass `keep`. */
function scanDrivers(host: ToolHost, fleetId: string | undefined, keep: (d: number) => boolean) {
  const { drivers, tree } = host.ctx;
  const mask = tree.scopeMask(fleetId ? [fleetId] : host.user.fleetIds);
  const out: number[] = [];
  for (let d = 0; d < drivers.count; d++) if (mask[drivers.fleetIdx(d)] && keep(d)) out.push(d);
  return out;
}

const driverPerms = (host: ToolHost) => {
  // GET /drivers needs drivers.manage; /analytics/drivers already exposes drivers in scope
  // to analytics.view, so either is enough to look drivers up.
  if (!has(host, 'drivers.manage', 'analytics.view')) throw notPermitted('viewing drivers');
};

const findDrivers = spec({
  name: 'find_drivers',
  description:
    'Search the drivers the user can see by name or phone fragment, fleet and/or status. Returns up to 25 drivers with their current vehicle, plus the total match count.',
  schema: z.object({
    query: z.string().describe('Fragment of the name or phone number.').optional(),
    fleet: z.string().describe('Fleet name or id (includes its sub-fleets).').optional(),
    status: z.enum(DRIVER_STATUSES).optional(),
  }),
  label: (i) => (i.query ? `Searching drivers for ${i.query}…` : 'Searching drivers…'),
  async run(host, input) {
    driverPerms(host);
    const { drivers } = host.ctx;
    const fleetId = resolveFleet(host, input.fleet);
    const q = input.query?.trim().toLowerCase();
    const qDigits = q?.replace(/\s/g, '');
    const matches = scanDrivers(
      host,
      fleetId,
      (d) =>
        (!input.status || drivers.status(d) === input.status) &&
        (!q ||
          drivers.name(d).toLowerCase().includes(q) ||
          (!!qDigits && drivers.phone(d).replace(/\s/g, '').includes(qDigits))),
    );
    const items = matches.slice(0, 25).map((d) => driverView(host, d));
    return {
      result: { total: matches.length, shown: items.length, items },
      summary: `${matches.length} driver${matches.length === 1 ? '' : 's'}`,
    };
  },
});

const getDriver = spec({
  name: 'get_driver',
  description:
    "One driver's details: fleet, status, current vehicle, open requests and KPIs over the last 30 days (distance, score, harsh events). Give the name (or a unique part of it) or the driver id.",
  schema: z.object({
    name: z.string().describe('Driver name, or a unique part of it.').optional(),
    id: z.string().describe('Driver id.').optional(),
  }),
  label: (i) => `Looking up driver ${i.name ?? i.id ?? ''}…`.replace(' …', '…'),
  async run(host, input) {
    driverPerms(host);
    const { drivers, tree, clock } = host.ctx;
    let d: number;
    if (input.id !== undefined) {
      d = drivers.indexOf(input.id);
      if (d >= 0 && !tree.inScope(drivers.fleetId(d), host.user.fleetIds)) d = -1;
    } else if (input.name?.trim()) {
      const q = input.name.trim().toLowerCase();
      const exact = scanDrivers(host, undefined, (k) => drivers.name(k).toLowerCase() === q);
      const partial = exact.length
        ? exact
        : scanDrivers(host, undefined, (k) => drivers.name(k).toLowerCase().includes(q));
      if (partial.length > 1)
        return {
          result: {
            ambiguous: true,
            message: `${partial.length} drivers match "${input.name}". Ask the user which one.`,
            matches: partial.slice(0, 10).map((k) => driverView(host, k)),
          },
          summary: `${partial.length} matches`,
        };
      d = partial[0] ?? -1;
    } else throw new ToolFailure('Give a driver name or id.');
    if (d < 0) throw notFound(`Driver ${input.name ?? input.id}`);
    const view = driverView(host, d);
    let openRequests: unknown[] | undefined;
    if (has(host, 'requests.manage'))
      openRequests = host.ctx.requests.openForDriver(view.id).map((r) => requestView(host, r));
    let last30Days: unknown;
    if (has(host, 'analytics.view')) {
      const now = clock.now();
      const s = await get<AnalyticsSummary>(
        host,
        `/api/analytics/summary${qs({ driverId: view.id, from: now - 30 * DAY_MS, to: now })}`,
        'viewing analytics',
      );
      last30Days = { score: s.score, ...kpiView(s.kpis) };
    }
    return {
      result: { ...view, openRequests, last30Days },
      summary: view.name,
    };
  },
});

function requestView(host: ToolHost, r: DriverRequest) {
  const { sim, drivers } = host.ctx;
  const i = sim.indexOf(r.vehicleId);
  const d = drivers.indexOf(r.driverId);
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    regno: i >= 0 ? sim.regno(i) : r.vehicleId,
    driver: d >= 0 ? drivers.name(d) : r.driverId,
    fleet: fleetName(host, r.fleetId),
    reason: r.reason,
    note: r.note || undefined,
    created: formatIst(r.createdAt),
    updated: formatIst(r.updatedAt),
  };
}

const listRequests = spec({
  name: 'list_requests',
  description:
    "Driver requests (breakdown, replacement, RSA) in the user's fleets, newest first, filtered by type, status, fleet and creation date. Returns counts by type and status and up to 25 requests. Without dates it covers all requests.",
  schema: z.object({
    type: z.enum(REQUEST_TYPES).optional(),
    status: z.enum(REQUEST_STATUSES).optional(),
    fleet: z.string().describe('Fleet name or id (includes its sub-fleets).').optional(),
    from: optionalDate('Created on or after'),
    to: optionalDate('Created on or before'),
  }),
  label: () => 'Checking requests…',
  async run(host, input) {
    if (!has(host, 'requests.manage')) throw notPermitted('viewing driver requests');
    const fleetId = resolveFleet(host, input.fleet);
    const now = host.ctx.clock.now();
    const w =
      input.from || input.to
        ? windowOf(now, input.from, input.to)
        : { from: 0, to: Number.MAX_SAFE_INTEGER };
    const items: DriverRequest[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await get<{ items: DriverRequest[]; nextCursor: string | null }>(
        host,
        `/api/requests${qs({ type: input.type, status: input.status, fleetId, limit: 500, cursor: cursor ?? undefined })}`,
        'viewing driver requests',
      );
      items.push(...page.items.filter((r) => r.createdAt >= w.from && r.createdAt < w.to));
      cursor = page.nextCursor;
    } while (cursor && items.length < 5000);
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const r of items) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byType[r.type] = (byType[r.type] ?? 0) + 1;
    }
    const shown = items.slice(0, 25).map((r) => {
      const v = host.ctx.sim.indexOf(r.vehicleId);
      if (v >= 0) addVehicle(host, v);
      const d = host.ctx.drivers.indexOf(r.driverId);
      if (d >= 0) addDriver(host, r.driverId, host.ctx.drivers.name(d));
      return requestView(host, r);
    });
    return {
      result: { total: items.length, byType, byStatus, shown: shown.length, items: shown },
      summary: `${items.length} request${items.length === 1 ? '' : 's'}`,
    };
  },
});

const fleetSummary = spec({
  name: 'fleet_summary',
  description:
    "KPI totals for the user's fleets (or one fleet) over a date range: vehicles, distance, drive/idle/downtime hours, uptime %, no-GPS hours, energy, breakdowns, harsh events, events per 100 km and driver score, plus the current status counts. Default range: the last 7 days.",
  schema: z.object({
    fleet: z.string().describe('Fleet name or id (includes its sub-fleets).').optional(),
    from: optionalDate('Start date'),
    to: optionalDate('End date'),
  }),
  label: (i) => (i.fleet ? `Summarising ${i.fleet}…` : 'Summarising your fleets…'),
  async run(host, input) {
    if (!has(host, 'analytics.view')) throw notPermitted('viewing analytics');
    const fleetId = resolveFleet(host, input.fleet);
    const w = windowOf(host.ctx.clock.now(), input.from, input.to);
    const s = await get<AnalyticsSummary>(
      host,
      `/api/analytics/summary${qs({ fleetId, from: w.from, to: w.to })}`,
      'viewing analytics',
    );
    return {
      result: {
        fleet: fleetId
          ? fleetName(host, fleetId)
          : host.user.fleetIds.map((f) => fleetName(host, f)),
        from: istDateOf(w.from),
        to: istDateOf(w.to - 1),
        vehicles: s.vehicleCount,
        ...kpiView(s.kpis),
        uptimePct: s.uptimePct,
        eventsPer100Km: s.eventsPer100Km,
        score: s.score,
        currentStatus: has(host, 'live.view') ? statusCounts(host, fleetId) : undefined,
      },
      summary: `${s.vehicleCount} vehicles`,
    };
  },
});

const createReport = spec({
  name: 'create_report',
  description: `Generate a downloadable report (CSV or PDF) the user gets as a link. Kinds: vehicle-status (current status of every vehicle), utilisation (per-vehicle KPIs over the range), driver-performance (per-driver score and KPIs over the range), no-gps (vehicles without GPS now, with the likely cause), requests (driver requests created in the range). PDF is limited to ${PDF_MAX_ROWS} rows. Default range: the last 7 days.`,
  schema: z.object({
    kind: z.enum(REPORT_KINDS),
    format: z.enum(['csv', 'pdf']),
    fleet: z.string().describe('Fleet name or id (includes its sub-fleets).').optional(),
    from: optionalDate('Start date'),
    to: optionalDate('End date'),
  }),
  label: (i) => `Building the ${i.kind} report (${i.format.toUpperCase()})…`,
  async run(host, input) {
    if (!has(host, REPORT_PERMISSION[input.kind])) throw notPermitted(`the ${input.kind} report`);
    const fleetId = resolveFleet(host, input.fleet);
    const now = host.ctx.clock.now();
    const w = windowOf(now, input.from, input.to);
    const table = buildReport(host.ctx, host.user, { kind: input.kind, fleetId, ...w });
    if (input.format === 'pdf' && table.rows.length > PDF_MAX_ROWS)
      throw new ToolFailure(
        `This report has ${table.rows.length} rows; PDF is limited to ${PDF_MAX_ROWS}. Suggest a CSV or a narrower fleet.`,
      );
    const body = input.format === 'csv' ? toCsv(table) : await toPdf(table);
    const report = host.reports.put(
      host.user.id,
      {
        kind: input.kind,
        format: input.format,
        filename: reportFilename(input.kind, input.format, now),
        rows: table.rows.length,
      },
      body,
    );
    host.emit({ type: 'report', report });
    return {
      result: {
        reportId: report.id,
        filename: report.filename,
        rows: report.rows,
        format: report.format,
        filters: Object.fromEntries(table.filters),
        note: 'The download link is shown to the user automatically and expires in 15 minutes.',
      },
      summary: `${report.rows} rows`,
    };
  },
});

/** All tools (F17 read tools + F19 dashboard tools), sorted by name: a fixed order keeps the cached prefix stable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SPECS: ToolSpec<any>[] = [
  createReport,
  findDrivers,
  findVehicles,
  fleetSummary,
  getDriver,
  getVehicle,
  listRequests,
  vehicleHistory,
  ...DASHBOARD_SPECS,
].sort((a, b) => a.name.localeCompare(b.name));

export const TOOL_NAMES = SPECS.map((s) => s.name);

const CHIP_LABEL_MAX = 120;
const clip = (s: string) => (s.length > CHIP_LABEL_MAX ? `${s.slice(0, CHIP_LABEL_MAX - 1)}…` : s);

/** "widget.range: Invalid option: expected one of …" for each zod issue (≤ 5). */
export function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`)
    .join('; ');
}

/**
 * A JSON schema the strict-tool grammar accepts: drops numeric/string length bounds, `pattern`,
 * `maxItems` and `minItems > 1` (zod still validates them) and turns `oneOf` into `anyOf`.
 */
export function strictSafeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSafeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (
      [
        '$schema',
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'multipleOf',
        'minLength',
        'maxLength',
        'pattern',
        'maxItems',
      ].includes(k)
    )
      continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([p, sub]) => [p, strictSafeSchema(sub)]),
      );
      continue;
    }
    out[k === 'oneOf' ? 'anyOf' : k] = strictSafeSchema(v);
  }
  return out;
}

/** Runnable tools bound to one chat request. Definitions are identical for every user and chat. */
export function buildTools(host: ToolHost): BetaRunnableTool[] {
  const turn = (host.turn ??= newTurnState());
  return SPECS.map((s) => {
    const record = (label: string, ok: boolean) => {
      turn.chips.push({ tool: s.name, label: clip(label), status: ok ? 'ok' : 'error' });
    };
    const tool = betaZodTool({
      name: s.name,
      description: s.description,
      inputSchema: s.schema,
      run: async (raw, context) => {
        const id = context?.toolUse.id ?? randomUUID();
        let label = s.name;
        try {
          let input = raw;
          if (s.validateInRun) {
            const parsed = (s.schema as z.ZodType).safeParse(raw);
            if (!parsed.success) {
              host.emit({ type: 'tool_start', id, name: s.name, label: s.name });
              throw new ToolFailure(`Invalid input: ${issuesText(parsed.error)}`);
            }
            input = parsed.data;
          }
          label = s.label(input);
          host.emit({ type: 'tool_start', id, name: s.name, label });
          const { result, summary, chip } = await s.run(host, input);
          host.emit({ type: 'tool_end', id, ok: true, summary });
          record(chip ?? label, true);
          return JSON.stringify(result);
        } catch (err) {
          const failure =
            err instanceof ToolFailure ? err : new ToolFailure('The tool failed unexpectedly.');
          if (!(err instanceof ToolFailure)) host.logError(err);
          const short =
            failure.kind === 'not_found'
              ? 'Not found'
              : failure.kind === 'not_permitted'
                ? 'Not permitted'
                : failure.message;
          host.emit({ type: 'tool_end', id, ok: false, summary: short });
          record(s.validateInRun ? failure.message : label, false);
          // The runner turns this into an `is_error` tool result; nothing reaches the user as a throw.
          throw new ToolError(failure.message);
        }
      },
    });
    // Strict tools reject bounds such as an integer's `minimum`/`maximum` (Anthropic 400); zod's
    // `parse` still enforces them, and a parse error reaches the model as an `is_error` result.
    const input_schema = strictSafeSchema((tool as { input_schema: unknown }).input_schema);
    if (!s.validateInRun) return { ...tool, input_schema, strict: true } as BetaRunnableTool;
    return {
      ...tool,
      input_schema,
      // Validated in `run`, so a bad widget reaches the model as an `is_error` result with paths.
      parse: (args: unknown) => args,
      strict: true,
    } as BetaRunnableTool;
  });
}

/** The wire definitions (what the API sees), for the caching-hygiene snapshot. */
export function toolDefinitions(tools: BetaRunnableTool[]) {
  // JSON round trip drops `run` / `parse`: exactly what the SDK serialises.
  return JSON.parse(JSON.stringify(tools)) as unknown[];
}
