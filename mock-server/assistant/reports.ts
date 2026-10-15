import {
  driverScore,
  IST_OFFSET_MS,
  REPORT_TTL_MS,
  type Permission,
  type ReportDescriptor,
  type ReportKind,
  type User,
} from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { MockContext } from '../context.ts';
import { DAY_MS, KPI_COUNT, toKpis } from '../generator/history-sim.ts';
import { noGpsInsight } from '../generator/no-gps-insight.ts';

/** F17 reports (D-106): CSV (F09 conventions) and PDF (pdf-lib), kept 15 min for their owner. */

export const PDF_MAX_ROWS = 5000;

/** Permission each report kind needs (the one the matching screen / route requires). */
export const REPORT_PERMISSION: Record<ReportKind, Permission> = {
  'vehicle-status': 'live.view',
  'no-gps': 'live.view',
  utilisation: 'analytics.view',
  'driver-performance': 'analytics.view',
  requests: 'requests.manage',
};

const TITLES: Record<ReportKind, string> = {
  'vehicle-status': 'Vehicle status',
  utilisation: 'Vehicle utilisation',
  'driver-performance': 'Driver performance',
  'no-gps': 'No-GPS vehicles',
  requests: 'Driver requests',
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  immobilized: 'Immobilized',
  'non-comm': 'Non-comm',
  charging: 'Charging',
  pullout: 'Pullout',
  'no-gps': 'No GPS',
  'gps-never': 'GPS never',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** `DD MMM YY | HH:mm:ss` in IST, as the F09 CSV export writes it (fast: no Intl). */
export function formatIst(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCFullYear() % 100)} | ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** IST calendar date `YYYY-MM-DD`. */
export const istDateOf = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

export interface ReportRequest {
  kind: ReportKind;
  /** Subtree root (already resolved and scope-checked), or the caller's whole scope. */
  fleetId?: string;
  /** Window for utilisation / driver-performance / requests; status kinds are "as of now". */
  from: number;
  to: number;
}

export interface ReportTable {
  kind: ReportKind;
  title: string;
  /** Label/value pairs printed under the PDF title. */
  filters: [string, string][];
  columns: string[];
  rows: string[][];
  generatedAt: number;
}

const fixed = (v: number, dp: number) => v.toFixed(dp);
const hours = (ms: number) => (ms / 3_600_000).toFixed(1);

/** Builds the rows of a report as `user` sees them (scope applied; permission checked by the caller). */
export function buildReport(ctx: MockContext, user: User, req: ReportRequest): ReportTable {
  const { sim, tree, clock, drivers, history, requests } = ctx;
  const now = clock.now();
  const roots = req.fleetId === undefined ? user.fleetIds : [req.fleetId];
  const mask = tree.scopeMask(roots);
  const fleetName = (id: string) => tree.get(id)?.name ?? id;
  const fleetLabel = roots.map(fleetName).join(', ');
  const rows: string[][] = [];
  let columns: string[];
  const range = `${istDateOf(req.from)} to ${istDateOf(req.to - 1)}`;
  let filters: [string, string][] = [['Fleet', fleetLabel]];

  switch (req.kind) {
    case 'vehicle-status': {
      // The F09 table columns, in table order.
      columns = [
        'Regno',
        'VIN',
        'Device ID',
        'Fleet',
        'Status',
        'Speed (km/h)',
        'SOC (%)',
        'DTE (km)',
        'ODO (km)',
        'Ignition',
        'Last GPS',
        'Last CAN',
        'Location',
      ];
      for (let i = 0; i < sim.count; i++) {
        if (!mask[sim.fleet[i]!]) continue;
        const status = sim.status(i, now);
        const s = sim.state(i, now);
        const hasFix = !(s.lat === 0 && s.lng === 0);
        rows.push([
          sim.regno(i),
          sim.vin(i),
          sim.deviceId(i),
          tree.node(sim.fleet[i]!).name,
          STATUS_LABEL[status],
          fixed(s.speed, 0),
          fixed(s.soc, 0),
          fixed(s.dte, 0),
          String(Math.floor(s.odometer)),
          s.ignstatus === 1 ? 'On' : 'Off',
          s.gpstime > 0 ? formatIst(s.gpstime) : '',
          s.canutctime > 0 ? formatIst(s.canutctime) : '',
          hasFix ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}` : '',
        ]);
      }
      filters.push(['As of', formatIst(now)]);
      break;
    }
    case 'no-gps': {
      columns = [
        'Regno',
        'Fleet',
        'Status',
        'Last GPS',
        'No GPS for (h)',
        'Likely cause',
        'Device battery low',
        'Weak signal',
        'Ignition off',
        'Device offline',
        'Explanation',
      ];
      const yn = (b: boolean) => (b ? 'Yes' : 'No');
      for (let i = 0; i < sim.count; i++) {
        if (!mask[sim.fleet[i]!]) continue;
        const insight = noGpsInsight(sim, i, now, requests.openBreakdown(sim.vehicleId(i))?.reason);
        if (!insight) continue;
        rows.push([
          sim.regno(i),
          tree.node(sim.fleet[i]!).name,
          STATUS_LABEL[sim.status(i, now)],
          formatIst(insight.since),
          hours(insight.durationMs),
          insight.likelyCause,
          yn(insight.signals.devBatteryLow),
          yn(insight.signals.weakSignal),
          yn(insight.signals.ignitionOff),
          yn(insight.signals.deviceOffline),
          insight.explanation,
        ]);
      }
      filters.push(['As of', formatIst(now)]);
      break;
    }
    case 'utilisation': {
      columns = [
        'Regno',
        'Fleet',
        'Distance (km)',
        'Drive (h)',
        'Idle (h)',
        'Downtime (h)',
        'Uptime (%)',
        'No GPS (h)',
        'Energy (kWh)',
        'Charge sessions',
        'Breakdowns',
        'Harsh brake',
        'Harsh accel',
        'Overspeed',
      ];
      const acc = new Float64Array(KPI_COUNT);
      for (let i = 0; i < sim.count; i++) {
        if (!mask[sim.fleet[i]!]) continue;
        acc.fill(0);
        history.addRange(i, req.from, req.to, acc);
        const k = toKpis(acc);
        const avail = k.uptimeMs + k.downtimeMs;
        rows.push([
          sim.regno(i),
          tree.node(sim.fleet[i]!).name,
          fixed(k.distanceKm, 1),
          hours(k.driveMs),
          hours(k.idleMs),
          hours(k.downtimeMs),
          avail > 0 ? fixed((k.uptimeMs / avail) * 100, 1) : '',
          hours(k.noGpsMs),
          fixed(k.energyKwh, 1),
          String(k.chargeSessions),
          String(k.breakdowns),
          String(k.harshBrake),
          String(k.harshAccel),
          String(k.overspeed),
        ]);
      }
      filters.push(['Period (IST)', range]);
      break;
    }
    case 'driver-performance': {
      columns = [
        'Driver',
        'Phone',
        'Fleet',
        'Status',
        'Current vehicle',
        'Score',
        'Distance (km)',
        'Vehicle-days',
        'Harsh brake',
        'Harsh accel',
        'Overspeed',
        'Breakdowns',
      ];
      const acc = new Float64Array(KPI_COUNT);
      for (let d = 0; d < drivers.count; d++) {
        if (!mask[drivers.fleetIdx(d)]) continue;
        acc.fill(0);
        let vehicleDays = 0;
        for (const a of drivers.driverHistory(d)) {
          const from = Math.max(req.from, a.from);
          const to = Math.min(req.to, a.to ?? req.to);
          if (to <= from) continue;
          history.addRange(sim.indexOf(a.vehicleId), from, to, acc);
          vehicleDays += (to - from) / DAY_MS;
        }
        const k = toKpis(acc);
        const score = driverScore(k);
        const v = drivers.vehicleOf(d);
        rows.push([
          drivers.name(d),
          drivers.phone(d),
          fleetName(drivers.fleetId(d)),
          drivers.status(d),
          v >= 0 ? sim.regno(v) : '',
          score === null ? '' : fixed(score, 1),
          fixed(k.distanceKm, 1),
          fixed(vehicleDays, 1),
          String(k.harshBrake),
          String(k.harshAccel),
          String(k.overspeed),
          String(k.breakdowns),
        ]);
      }
      filters.push(['Period (IST)', range]);
      break;
    }
    case 'requests': {
      columns = [
        'Request',
        'Type',
        'Status',
        'Regno',
        'Driver',
        'Fleet',
        'Reason',
        'Note',
        'Created',
        'Updated',
      ];
      const all = requests.all;
      for (let k = all.length - 1; k >= 0; k--) {
        const r = all[k]!;
        if (r.createdAt < req.from || r.createdAt >= req.to) continue;
        if (!tree.inScope(r.fleetId, roots)) continue;
        const i = sim.indexOf(r.vehicleId);
        const d = drivers.indexOf(r.driverId);
        rows.push([
          r.id,
          r.type,
          r.status,
          i >= 0 ? sim.regno(i) : r.vehicleId,
          d >= 0 ? drivers.name(d) : r.driverId,
          fleetName(r.fleetId),
          r.reason ?? '',
          r.note,
          formatIst(r.createdAt),
          formatIst(r.updatedAt),
        ]);
      }
      filters = [...filters, ['Created (IST)', range]];
      break;
    }
  }
  return {
    kind: req.kind,
    title: `${TITLES[req.kind]} report`,
    filters,
    columns,
    rows,
    generatedAt: now,
  };
}

// ---- CSV ----

/** RFC 4180 (same rule as the F09 exporter). */
export const csvField = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csvLine = (values: string[]) => `${values.map(csvField).join(',')}\r\n`;

export function toCsv(table: ReportTable): string {
  const parts = [csvLine(table.columns)];
  for (const r of table.rows) parts.push(csvLine(r));
  return parts.join('');
}

// ---- PDF ----

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN = 32;
const FONT_SIZE = 7;
const LINE = 11;

/** Standard PDF fonts only encode WinAnsi; replace anything else so drawing never throws. */
const pdfSafe = (s: string) =>
  s
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '?');

/** A4 landscape: title, filters, generated-at (IST), the table, "Page n of m". */
export async function toPdf(table: ReportTable): Promise<Uint8Array> {
  if (table.rows.length > PDF_MAX_ROWS)
    throw new Error(`PDF reports are limited to ${PDF_MAX_ROWS} rows`);
  const doc = await PDFDocument.create();
  doc.setTitle(table.title);
  doc.setCreator('FMS Assistant');
  doc.setProducer('FMS');
  doc.setCreationDate(new Date(table.generatedAt));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = A4_LANDSCAPE;
  const usable = width - 2 * MARGIN;

  // Column widths: proportional to the longest value in a sample, capped.
  const sample = table.rows.slice(0, 200);
  const weights = table.columns.map((c, j) =>
    Math.min(40, Math.max(c.length, ...sample.map((r) => r[j]!.length), 4)),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * usable);
  const maxChars = widths.map((w) => Math.max(3, Math.floor((w - 4) / (FONT_SIZE * 0.5))));
  const clip = (s: string, j: number) => {
    const t = pdfSafe(s);
    return t.length > maxChars[j]! ? `${t.slice(0, maxChars[j]! - 3)}...` : t;
  };

  const header = (page: PDFPage, first: boolean): number => {
    let y = height - MARGIN;
    if (first) {
      page.drawText(pdfSafe(table.title), { x: MARGIN, y: y - 14, size: 16, font: bold });
      y -= 30;
      const meta = [...table.filters, ['Generated (IST)', formatIst(table.generatedAt)]];
      meta.push(['Rows', String(table.rows.length)]);
      for (const [k, v] of meta) {
        page.drawText(pdfSafe(`${k}: ${v}`), { x: MARGIN, y, size: 9, font });
        y -= 12;
      }
      y -= 6;
    }
    drawRow(page, font, bold, table.columns.map(clip), widths, y, true);
    return y - LINE - 2;
  };

  let page = doc.addPage(A4_LANDSCAPE);
  let y = header(page, true);
  for (const r of table.rows) {
    if (y < MARGIN + LINE) {
      page = doc.addPage(A4_LANDSCAPE);
      y = header(page, false);
    }
    drawRow(
      page,
      font,
      bold,
      r.map((v, j) => clip(v, j)),
      widths,
      y,
      false,
    );
    y -= LINE;
  }
  if (table.rows.length === 0)
    page.drawText('No rows match this report.', { x: MARGIN, y, size: 9, font });

  const pages = doc.getPages();
  pages.forEach((p, n) =>
    p.drawText(`Page ${n + 1} of ${pages.length}`, {
      x: width - MARGIN - 60,
      y: MARGIN / 2,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }),
  );
  return doc.save({ useObjectStreams: true });
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  cells: string[],
  widths: number[],
  y: number,
  isHeader: boolean,
) {
  let x = MARGIN;
  if (isHeader)
    page.drawRectangle({
      x: MARGIN - 2,
      y: y - 3,
      width: widths.reduce((a, b) => a + b, 0) + 4,
      height: LINE,
      color: rgb(0.9, 0.9, 0.9),
    });
  cells.forEach((c, j) => {
    if (c) page.drawText(c, { x, y, size: FONT_SIZE, font: isHeader ? bold : font });
    x += widths[j]!;
  });
}

// ---- store ----

interface StoredReport {
  descriptor: ReportDescriptor;
  ownerId: string;
  contentType: string;
  body: string | Uint8Array;
}

/** Generated reports, kept `REPORT_TTL_MS` (15 min) for the user who asked for them. */
export class ReportStore {
  private readonly items = new Map<string, StoredReport>();

  constructor(private readonly now: () => number) {}

  put(
    ownerId: string,
    meta: Pick<ReportDescriptor, 'kind' | 'format' | 'filename' | 'rows'>,
    body: string | Uint8Array,
  ): ReportDescriptor {
    this.sweep();
    const id = randomUUID();
    const descriptor: ReportDescriptor = {
      id,
      ...meta,
      url: `/api/chat/reports/${id}`,
      expiresAt: this.now() + REPORT_TTL_MS,
    };
    const contentType = meta.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf';
    this.items.set(id, { descriptor, ownerId, contentType, body });
    return descriptor;
  }

  /** The report if it exists, belongs to `ownerId` and has not expired. */
  get(id: string, ownerId: string): StoredReport | undefined {
    const r = this.items.get(id);
    if (!r) return undefined;
    if (r.descriptor.expiresAt <= this.now()) {
      this.items.delete(id);
      return undefined;
    }
    return r.ownerId === ownerId ? r : undefined;
  }

  get size(): number {
    return this.items.size;
  }

  sweep(): void {
    const now = this.now();
    for (const [id, r] of this.items) if (r.descriptor.expiresAt <= now) this.items.delete(id);
  }
}

/** `vehicle-status-2026-10-14-1530.csv` (IST). */
export function reportFilename(kind: ReportKind, format: 'csv' | 'pdf', at: number): string {
  const d = new Date(at + IST_OFFSET_MS);
  const stamp = `${d.toISOString().slice(0, 10)}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
  return `${kind}-${stamp}.${format}`;
}
