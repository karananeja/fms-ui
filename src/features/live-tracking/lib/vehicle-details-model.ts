import type { Combinfo, Lafparsed } from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { formatIst } from '@/shared/lib/format-date';
import {
  detailsConfig,
  type DetailsConfig,
  type ParameterGroupId,
} from '../config/details-config.ts';
import { statusRulesConfig } from '../config/status-rules-config.ts';
import { isValidPosition } from '../worker/position.ts';
import type { HistoryEvent, HistorySample } from '../worker/selected-history.ts';
import type { SelectedVehicle, VehicleSummary } from '../worker/worker-api.ts';
import { formatRelative } from './format-relative.ts';
import { humanizePid } from './humanize-pid.ts';

/** Colour role of a value; components map it to a token with `TONE_COLOR`. */
export type Tone = 'ok' | 'warn' | 'bad' | 'none';

export const DASH = '—';
export const NA = 'N/A';

export type Illustration = 'e-scooter' | 'e-3w' | 'e-car' | 'truck';

export interface TimeCell {
  /** Absolute IST time (`formatIst`), or "—". */
  abs: string;
  /** "2 min ago", or "—". */
  rel: string;
  tone: Tone;
  at: number;
}

export interface DetailsHeader {
  vehicleId: string;
  regno: string;
  /** `MAKE · MODEL · VARIANT` (uppercase). */
  subtitle: string;
  fuel: string | null;
  status: VehicleStatus | null;
  illustration: Illustration;
  gps: TimeCell;
  can: TimeCell;
  /** The newer of the two absolute times. */
  latest: string;
}

export interface Badges {
  /** dBm text, e.g. "−70". */
  signal: string;
  /** 0–3 lit bars of 4. */
  bars: number;
  fix: string;
  fixTone: Tone;
}

export interface Ring {
  value: string;
  unit: string;
  /** 0–1 fill, or null (empty ring). */
  fill: number | null;
  tone: Tone | 'accent';
}

export interface Rings {
  battery: Ring;
  range: Ring;
  health: Ring;
}

export interface Overview {
  speed: number | null;
  speedText: string;
  odo: string;
  motorSpeed: string;
  motorTemp: string;
  ignition: { on: boolean | null; text: string };
}

export interface DeviceView {
  deviceId: string;
  aux: string;
  auxTone: Tone;
  internal: string;
  signal: string;
  fix: string;
  fixTone: Tone;
}

export interface Cell {
  key: string;
  label: string;
  volts: number;
  text: string;
  lowest: boolean;
}

export interface ParameterCell {
  key: string;
  label: string;
  value: string;
  na: boolean;
  /** Hover text: key + the value's own timestamp. */
  title: string;
}

export interface Highlight {
  key: string;
  label: string;
  value: string;
}

export interface EventItem {
  key: string;
  time: string;
  title: string;
  detail: string;
  status: VehicleStatus | null;
}

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDp = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const raw = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: detailsConfig.paramMaxFractionDigits,
});

/** A usable number: finite and not an N/A sentinel. */
export function value(
  v: number | null | undefined,
  cfg: DetailsConfig = detailsConfig,
): number | null {
  return typeof v === 'number' && Number.isFinite(v) && !cfg.naSentinels.includes(v) ? v : null;
}

const fmt = (v: number | null, f: Intl.NumberFormat) => (v === null ? DASH : f.format(v));
/** Signed numbers with a typographic minus. */
const signed = (s: string) => s.replace('-', '−');

/** `HH:mm` in IST. */
export const istTime = (t: number) => formatIst(t).slice(12, 17);

export function freshnessTone(at: number, now: number, cfg: DetailsConfig = detailsConfig): Tone {
  if (!Number.isFinite(at) || at <= 0) return 'none';
  const age = now - at;
  if (age <= cfg.freshness.okMs) return 'ok';
  return age <= cfg.freshness.warnMs ? 'warn' : 'bad';
}

export function socTone(soc: number | null, cfg: DetailsConfig = detailsConfig): Tone {
  if (soc === null) return 'none';
  if (soc < cfg.socBands.low) return 'bad';
  return soc < cfg.socBands.mid ? 'warn' : 'ok';
}

/** Lit bars (0–3) for a signal strength in dBm. */
export function signalBars(dbm: number | null, cfg: DetailsConfig = detailsConfig): number {
  return dbm === null ? 0 : cfg.signalBars.filter((t) => dbm >= t).length;
}

export function gpsFix(q: number | null): { text: string; tone: Tone } {
  if (q === null) return { text: DASH, tone: 'none' };
  return q === 0 ? { text: 'NONE', tone: 'warn' } : { text: `FIX ${q}`, tone: 'ok' };
}

export function illustrationFor(assetType: string | undefined): Illustration {
  const t = (assetType ?? '').toLowerCase();
  if (t.includes('3w')) return 'e-3w';
  if (t.includes('car')) return 'e-car';
  if (t.includes('truck')) return 'truck';
  return 'e-scooter';
}

function timeCell(at: number | undefined, now: number): TimeCell {
  const t = at ?? NaN;
  const tone = freshnessTone(t, now);
  return tone === 'none'
    ? { abs: DASH, rel: DASH, tone, at: NaN }
    : { abs: formatIst(t), rel: formatRelative(t, now), tone, at: t };
}

export function headerModel(
  vehicleId: string,
  summary: VehicleSummary | null,
  combinfo: Combinfo | null,
  status: VehicleStatus | null,
  now: number,
): DetailsHeader {
  const legacy = combinfo?.appmeta.legacy_appmeta;
  const parts = summary
    ? [summary.make, summary.model, summary.variant]
    : [legacy?.manufacturer, legacy?.model, legacy?.variant];
  const gps = timeCell(combinfo?.gpstime ?? summary?.gpstime, now);
  const can = timeCell(combinfo?.canutctime ?? summary?.canutctime, now);
  const newer = !(can.at > gps.at) ? gps : can;
  return {
    vehicleId,
    regno: combinfo?.regno || summary?.regno || vehicleId,
    subtitle: parts.filter(Boolean).join(' · ').toUpperCase(),
    fuel: combinfo?.appmeta.fueltype || summary?.fuelType || null,
    status: status ?? summary?.status ?? null,
    illustration: illustrationFor(combinfo?.assettype ?? summary?.assetType),
    gps,
    can,
    latest: Number.isNaN(gps.at) ? can.abs : newer.abs,
  };
}

export function badgesModel(c: Combinfo): Badges {
  const dbm = value(c.rxdbm);
  const fix = gpsFix(value(c.fixquality));
  return { signal: signed(fmt(dbm, int)), bars: signalBars(dbm), fix: fix.text, fixTone: fix.tone };
}

const ring = (
  v: number | null,
  max: number,
  text: string,
  unit: string,
  tone: Ring['tone'],
): Ring => ({
  value: v === null ? DASH : text,
  unit,
  fill: v === null ? null : Math.max(0, Math.min(1, v / max)),
  tone: v === null ? 'none' : tone,
});

export function ringsModel(
  c: Combinfo | null,
  l: Lafparsed | null,
  cfg: DetailsConfig = detailsConfig,
): Rings {
  const soc = value(c?.parsedcandata.soc?.pidvalue, cfg);
  const dte = value(c?.parsedcandata.dte?.pidvalue, cfg);
  const soh = value(l?.candata.soh?.pidvalue, cfg);
  return {
    battery: ring(
      soc,
      100,
      `${fmt(soc === null ? null : Math.round(soc), int)}%`,
      'SOC',
      socTone(soc, cfg),
    ),
    range: ring(dte, cfg.rangeRingMax, fmt(dte, int), 'KM', 'accent'),
    health: ring(
      soh,
      100,
      fmt(soh, oneDp),
      'SOH %',
      soh !== null && soh >= cfg.sohOk ? 'ok' : 'warn',
    ),
  };
}

export function overviewModel(c: Combinfo, cfg: DetailsConfig = detailsConfig): Overview {
  const can = c.parsedcandata;
  const speed = value(c.speed, cfg);
  const odo = value(can.odometer?.pidvalue, cfg);
  const on = Number.isFinite(c.lastignon) && c.lastignon > 0 ? c.lastignon : null;
  const off = Number.isFinite(c.lastignoff) && c.lastignoff > 0 ? c.lastignoff : null;
  const isOn = on === null && off === null ? null : (on ?? 0) > (off ?? 0);
  const at = isOn ? on : off;
  return {
    speed,
    speedText: fmt(speed === null ? null : Math.round(speed), int),
    odo: odo === null ? DASH : `${int.format(Math.floor(odo))} KM`,
    motorSpeed: fmt(value(can.engine_speed?.pidvalue, cfg), int) + ' RPM',
    motorTemp: fmt(value(can.motor_temperature?.pidvalue, cfg), raw),
    ignition: {
      on: isOn,
      text: isOn === null ? DASH : `${isOn ? 'ON' : 'OFF'} · ${istTime(at!)}`,
    },
  };
}

export function deviceModel(c: Combinfo, rules = statusRulesConfig): DeviceView {
  const aux = value(c.carbattery);
  const fix = gpsFix(value(c.fixquality));
  return {
    deviceId: c.deviceid || DASH,
    aux: aux === null ? DASH : `${twoDp.format(aux)} V`,
    auxTone: aux !== null && aux < rules.thresholds.pulloutVolts ? 'bad' : 'none',
    internal: value(c.devbattery) === null ? DASH : `${twoDp.format(c.devbattery)} V`,
    signal: value(c.rxdbm) === null ? DASH : `${signed(int.format(c.rxdbm))} DBM`,
    fix: fix.text,
    fixTone: fix.tone,
  };
}

/** `lat, lng` to 5 decimals, or "—" without a valid fix. */
export function locationModel(c: Combinfo): string {
  const { latitude: lat, longitude: lng } = c;
  return isValidPosition(lat, lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : DASH;
}

/** `cell_voltage_01…NN` bars (missing cells skipped); the lowest is flagged. */
export function cellStrip(l: Lafparsed, cfg: DetailsConfig = detailsConfig): Cell[] {
  const cells: Cell[] = [];
  for (let n = 1; n <= cfg.cellCount; n++) {
    const key = `cell_voltage_${String(n).padStart(2, '0')}`;
    const v = value(l.candata[key]?.pidvalue, cfg);
    if (v !== null)
      cells.push({ key, label: `Cell ${n}`, volts: v, text: raw.format(v), lowest: false });
  }
  if (cells.length) cells.reduce((a, b) => (b.volts < a.volts ? b : a)).lowest = true;
  return cells;
}

/** Every lafparsed PID as a cell, sorted A–Z by label (raw value, no units — D-017). */
export function parameterCells(l: Lafparsed, cfg: DetailsConfig = detailsConfig): ParameterCell[] {
  const cells: ParameterCell[] = [];
  for (const [key, pid] of Object.entries(l.candata)) {
    const v = pid.pidvalue;
    const na = cfg.naSentinels.includes(v);
    cells.push({
      key,
      label: humanizePid(key),
      value: na ? NA : Number.isFinite(v) ? raw.format(v) : DASH,
      na,
      title: `${key} · ${formatIst(pid.timestamp)}`,
    });
  }
  return cells.sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
}

export function highlights(l: Lafparsed, cfg: DetailsConfig = detailsConfig): Highlight[] {
  return cfg.highlightPids
    .filter((key) => l.candata[key])
    .map((key) => {
      const v = value(l.candata[key]!.pidvalue, cfg);
      return { key, label: humanizePid(key), value: v === null ? NA : raw.format(v) };
    });
}

export function inGroup(key: string, group: ParameterGroupId, cfg: DetailsConfig = detailsConfig) {
  const m = cfg.parameterGroups.find((g) => g.id === group)?.match;
  if (!m) return true;
  return 'prefix' in m ? key.startsWith(m.prefix) : key.includes(m.includes);
}

/** Group chip, then case-insensitive substring match on label or key. */
export function filterParameters(
  cells: ParameterCell[],
  query: string,
  group: ParameterGroupId = 'all',
): ParameterCell[] {
  const q = query.trim().toLowerCase();
  if (!q && group === 'all') return cells;
  return cells.filter(
    (c) =>
      inGroup(c.key, group) &&
      (!q || c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)),
  );
}

export interface SessionChart {
  /** SVG path points in a 0–1 box (x by time, y = 1 − soc/100). */
  points: [number, number][];
  latest: number;
  ticks: { x: number; label: string }[];
  tone: Tone;
}

/** SOC over the session; null with fewer than 2 SOC samples ("Collecting…"). */
export function sessionChart(samples: readonly HistorySample[]): SessionChart | null {
  const s = samples.filter((x) => x.soc !== null);
  if (s.length < 2) return null;
  const t0 = s[0]!.t;
  const span = Math.max(1, s.at(-1)!.t - t0);
  const points = s.map((x): [number, number] => [
    (x.t - t0) / span,
    1 - Math.max(0, Math.min(100, x.soc!)) / 100,
  ]);
  const latest = s.at(-1)!.soc!;
  return {
    points,
    latest,
    ticks: [
      { x: 0, label: istTime(t0) },
      { x: 0.5, label: istTime(t0 + span / 2) },
      { x: 1, label: 'NOW' },
    ],
    tone: socTone(latest),
  };
}

const EVENT_TITLES: Record<VehicleStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  immobilized: 'Immobilized',
  'non-comm': 'Stopped communicating',
  charging: 'Charging',
  pullout: 'Battery pulled out',
  'no-gps': 'GPS lost',
  'gps-never': 'No GPS fix yet',
};

/** Timeline items, newest first. */
export function eventItems(events: readonly HistoryEvent[]): EventItem[] {
  return events
    .map((e, k): EventItem => {
      const where =
        e.lat !== null && e.lng !== null ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : null;
      const soc = e.soc === null ? null : `SOC ${Math.round(e.soc)}%`;
      const title =
        e.kind === 'status'
          ? e.status
            ? EVENT_TITLES[e.status]
            : DASH
          : `Ignition ${e.kind === 'ignition-on' ? 'on' : 'off'}`;
      const status =
        e.kind === 'ignition-on' ? 'running' : e.kind === 'ignition-off' ? 'stopped' : e.status;
      return {
        key: `${e.kind}-${e.t}-${k}`,
        time: istTime(e.t),
        title,
        detail: (e.kind === 'ignition-on' ? (soc ?? where) : (where ?? soc)) ?? DASH,
        status,
      };
    })
    .reverse();
}

/** CSS colour token per tone. */
export const TONE_COLOR: Record<Tone | 'accent', string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  none: 'var(--text-muted)',
  accent: 'var(--accent-2)',
};

/** 8-point compass label for a heading in degrees. */
export function compassLabel(heading: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((heading % 360) + 360) % 360) / 45) % 8]!;
}

export interface CalloutView {
  regno: string;
  status: VehicleStatus | null;
  /** `0 km/h · 49% SoC` */
  meta: string;
}

/** Map callout for the selected vehicle (payload first, else its fleet summary). */
export function calloutModel(s: {
  selectedVehicleId: string | null;
  selected: SelectedVehicle | null;
  selectedSummary: VehicleSummary | null;
}): CalloutView | null {
  const id = s.selectedVehicleId;
  if (!id) return null;
  const c = s.selected?.vehicleId === id ? s.selected.combinfo : null;
  const sum = s.selectedSummary?.vehicleId === id ? s.selectedSummary : null;
  const speed = value(c ? c.speed : sum?.speed);
  const soc = value(c ? c.parsedcandata.soc?.pidvalue : sum?.soc);
  return {
    regno: c?.regno || sum?.regno || id,
    status: (s.selected?.vehicleId === id ? s.selected.status : null) ?? sum?.status ?? null,
    meta: `${speed === null ? DASH : Math.round(speed)} km/h · ${soc === null ? DASH : Math.round(soc)}% SoC`,
  };
}
