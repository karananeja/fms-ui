// @vitest-environment node
import { REPORT_KINDS, REPORT_TTL_MS, type ReportKind } from '@shared/contract/index.ts';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../build-server.ts';
import { DAY_MS } from '../generator/history-sim.ts';
import {
  buildReport,
  formatIst,
  PDF_MAX_ROWS,
  ReportStore,
  reportFilename,
  toCsv,
  toPdf,
  type ReportTable,
} from './reports.ts';

/** F17-T2: report builders, CSV/PDF output, the 15 min store; budgets at 1 lakh vehicles. */
let small: ReturnType<typeof buildServer>;
let big: ReturnType<typeof buildServer>;

beforeAll(async () => {
  small = buildServer({ vehicles: 2000 });
  big = buildServer({ vehicles: 100_000 });
  await Promise.all([small.ready(), big.ready()]);
}, 60_000);
afterAll(async () => {
  await Promise.all([small.close(), big.close()]);
});

const ops = () => small.mock.accounts.user('u-ops');
const table = (kind: ReportKind, app = small, user = ops()) => {
  const now = app.mock.clock.now();
  return buildReport(app.mock, user, { kind, from: now - 7 * DAY_MS, to: now });
};

const HEADERS: Record<ReportKind, string> = {
  'vehicle-status':
    'Regno,VIN,Device ID,Fleet,Status,Speed (km/h),SOC (%),DTE (km),ODO (km),Ignition,Last GPS,Last CAN,Location',
  'no-gps':
    'Regno,Fleet,Status,Last GPS,No GPS for (h),Likely cause,Device battery low,Weak signal,Ignition off,Device offline,Explanation',
  utilisation:
    'Regno,Fleet,Distance (km),Drive (h),Idle (h),Downtime (h),Uptime (%),No GPS (h),Energy (kWh),Charge sessions,Breakdowns,Harsh brake,Harsh accel,Overspeed',
  'driver-performance':
    'Driver,Phone,Fleet,Status,Current vehicle,Score,Distance (km),Vehicle-days,Harsh brake,Harsh accel,Overspeed,Breakdowns',
  requests: 'Request,Type,Status,Regno,Driver,Fleet,Reason,Note,Created,Updated',
};

describe('F17-T2 reports', () => {
  it.each(REPORT_KINDS)('%s: CSV header and rows in the user scope', (kind) => {
    const t = table(kind);
    const lines = toCsv(t).split('\r\n');
    expect(lines[0]).toBe(HEADERS[kind]);
    expect(lines.at(-1)).toBe('');
    expect(lines.length - 2).toBe(t.rows.length);
    for (const r of t.rows) expect(r).toHaveLength(t.columns.length);
    if (kind !== 'requests') expect(t.rows.length).toBeGreaterThan(0);
  });

  it('vehicle-status covers exactly the vehicles in scope, with IST times', () => {
    const { sim, tree } = small.mock;
    const inScope = [...Array(sim.count).keys()].filter((i) =>
      tree.inScope(sim.fleetId(i), ops().fleetIds),
    ).length;
    const t = table('vehicle-status');
    expect(t.rows.length).toBe(inScope);
    expect(t.rows.find((r) => r[10])![10]).toMatch(
      /^\d{2} [A-Z][a-z]{2} \d{2} \| \d{2}:\d{2}:\d{2}$/,
    );
    // 2026-10-14 06:30 UTC = 12:00 IST
    expect(formatIst(Date.UTC(2026, 9, 14, 6, 30, 0))).toBe('14 Oct 26 | 12:00:00');
    expect(reportFilename('no-gps', 'pdf', Date.UTC(2026, 9, 14, 6, 30))).toBe(
      'no-gps-2026-10-14-1200.pdf',
    );
  });

  it('no-gps lists only vehicles without GPS, each with a likely cause', () => {
    const t = table('no-gps');
    expect(t.rows.every((r) => r[2] === 'No GPS' || r[2] === 'Non-comm')).toBe(true);
    expect(t.rows.every((r) => r[5] !== '')).toBe(true);
  });

  it('PDF: reloads with pdf-lib, title, page count; > 5k rows is refused', async () => {
    const t = table('utilisation');
    const doc = await PDFDocument.load(await toPdf(t));
    expect(doc.getTitle()).toBe('Vehicle utilisation report');
    const perPage = 45;
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(Math.ceil(t.rows.length / perPage) - 1);
    const empty = await PDFDocument.load(await toPdf({ ...t, rows: [] }));
    expect(empty.getPageCount()).toBe(1);
    await expect(
      toPdf({ ...t, rows: Array.from({ length: PDF_MAX_ROWS + 1 }, () => t.rows[0]!) }),
    ).rejects.toThrow(/limited/);
  });

  it('store: owner only, expires after 15 min', () => {
    let now = 1_000_000;
    const store = new ReportStore(() => now);
    const d = store.put(
      'u-ops',
      { kind: 'no-gps', format: 'csv', filename: 'x.csv', rows: 1 },
      'a\r\n',
    );
    expect(d.url).toBe(`/api/chat/reports/${d.id}`);
    expect(d.expiresAt).toBe(now + REPORT_TTL_MS);
    expect(store.get(d.id, 'u-ops')?.contentType).toBe('text/csv; charset=utf-8');
    expect(store.get(d.id, 'u-superadmin')).toBeUndefined();
    now += REPORT_TTL_MS;
    expect(store.get(d.id, 'u-ops')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('budgets: 1 lakh-row CSV ≤ 3 s, 5k-row PDF ≤ 3 s', async () => {
    const admin = big.mock.accounts.user('u-superadmin');
    let t0 = performance.now();
    const t = table('vehicle-status', big, admin);
    const csv = toCsv(t);
    const csvMs = performance.now() - t0;
    expect(t.rows.length).toBe(100_000);
    expect(csv.length).toBeGreaterThan(1_000_000);
    const pdfTable: ReportTable = { ...t, rows: t.rows.slice(0, PDF_MAX_ROWS) };
    t0 = performance.now();
    const pdf = await toPdf(pdfTable);
    const pdfMs = performance.now() - t0;
    console.info(
      `[F17 budgets] CSV 1 lakh rows ${csvMs.toFixed(0)} ms, PDF 5k rows ${pdfMs.toFixed(0)} ms (${(pdf.length / 1e6).toFixed(1)} MB)`,
    );
    expect(csvMs).toBeLessThan(3000);
    expect(pdfMs).toBeLessThan(3000);
  }, 30_000);
});
