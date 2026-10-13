import type { Combinfo, Lafparsed } from '@shared/contract/index.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { formatIst } from '@/shared/lib/format-date';
import { detailsConfig, type DetailsConfig } from '../config/details-config.ts';
import { isValidPosition } from '../worker/position.ts';
import type { SelectedVehicle, VehicleSummary } from '../worker/worker-api.ts';
import { humanizePid } from './humanize-pid.ts';

/** Colour role of a value; the component maps it to a token (ok / warn / stopped / muted). */
export type Tone = 'ok' | 'warn' | 'bad' | 'none';

export const DASH = '—';
export const NA = 'N/A';

export interface TimeCell {
  text: string;
  tone: Tone;
}

export interface DetailsHeader {
  vehicleId: string;
  regno: string;
  subtitle: string;
  fuel: string | null;
  status: VehicleStatus | null;
  gps: TimeCell;
  can: TimeCell;
}

export interface DrivingEnergy {
  speed: string;
  speedValue: number | null;
  soc: string;
  socPct: number | null;
  socTone: Tone;
  dte: string;
  soh: string;
  odo: string;
  /** ODO as zero-padded digits for the odometer strip. */
  odoDigits: string[];
  rpmValue: number | null;
  rpm: string;
}

export interface DeviceComms {
  deviceId: string;
  aux: string;
  internal: string;
  signal: string;
}

export interface ParameterCell {
  key: string;
  label: string;
  value: string;
  /** Hover text: key + the value's own timestamp. */
  title: string;
}

export interface VehicleDetailsView {
  header: DetailsHeader;
  /** Null until the full `combinfo` payload arrives (skeleton). */
  drivingEnergy: DrivingEnergy | null;
  device: DeviceComms | null;
  location: string | null;
  /** Null until the `lafparsed` payload arrives (skeleton). */
  parameters: ParameterCell[] | null;
}

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDp = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const raw = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: detailsConfig.paramMaxFractionDigits,
});

/** A usable number: finite and not an N/A sentinel. */
function value(v: number | null | undefined, cfg: DetailsConfig = detailsConfig): number | null {
  return typeof v === 'number' && Number.isFinite(v) && !cfg.naSentinels.includes(v) ? v : null;
}

const fmt = (v: number | null, f: Intl.NumberFormat) => (v === null ? DASH : f.format(v));

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

function timeCell(at: number | undefined, now: number): TimeCell {
  const tone = freshnessTone(at ?? NaN, now);
  return { text: tone === 'none' ? DASH : formatIst(at!), tone };
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
  return {
    vehicleId,
    regno: combinfo?.regno || summary?.regno || vehicleId,
    subtitle: parts.filter(Boolean).join(' · '),
    fuel: combinfo?.appmeta.fueltype || summary?.fuelType || null,
    status: status ?? summary?.status ?? null,
    gps: timeCell(combinfo?.gpstime ?? summary?.gpstime, now),
    can: timeCell(combinfo?.canutctime ?? summary?.canutctime, now),
  };
}

export function drivingEnergyModel(
  combinfo: Combinfo,
  lafparsed: Lafparsed | null,
  cfg: DetailsConfig = detailsConfig,
): DrivingEnergy {
  const can = combinfo.parsedcandata;
  const speed = value(combinfo.speed, cfg);
  const soc = value(can.soc?.pidvalue, cfg);
  const odo = value(can.odometer?.pidvalue, cfg);
  const rpm = value(can.engine_speed?.pidvalue, cfg);
  const odoInt = odo === null ? null : Math.floor(odo);
  return {
    speedValue: speed,
    speed: fmt(speed === null ? null : Math.round(speed), int),
    socPct: soc === null ? null : Math.max(0, Math.min(100, soc)),
    soc: fmt(soc === null ? null : Math.round(soc), int),
    socTone: socTone(soc, cfg),
    dte: fmt(value(can.dte?.pidvalue, cfg), int),
    soh: fmt(value(lafparsed?.candata.soh?.pidvalue, cfg), oneDp),
    odo: fmt(odoInt, int),
    odoDigits: (odoInt === null ? '' : String(odoInt))
      .padStart(cfg.odoDigits, odoInt === null ? '-' : '0')
      .split(''),
    rpmValue: rpm,
    rpm: fmt(rpm, int),
  };
}

export function deviceModel(combinfo: Combinfo): DeviceComms {
  return {
    deviceId: combinfo.deviceid || DASH,
    aux: fmt(value(combinfo.carbattery), twoDp),
    internal: fmt(value(combinfo.devbattery), twoDp),
    signal: fmt(value(combinfo.rxdbm), int),
  };
}

/** `lat, lng` to 5 decimals, or "—" without a valid fix. */
export function locationModel(combinfo: Combinfo): string {
  const { latitude: lat, longitude: lng } = combinfo;
  return isValidPosition(lat, lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : DASH;
}

/** Every lafparsed PID as a cell, sorted A–Z by label (raw value, no units — D-017). */
export function parameterCells(
  lafparsed: Lafparsed,
  cfg: DetailsConfig = detailsConfig,
): ParameterCell[] {
  const cells: ParameterCell[] = [];
  for (const [key, pid] of Object.entries(lafparsed.candata)) {
    const v = pid.pidvalue;
    cells.push({
      key,
      label: humanizePid(key),
      value: cfg.naSentinels.includes(v) ? NA : Number.isFinite(v) ? raw.format(v) : DASH,
      title: `${key} · ${formatIst(pid.timestamp)}`,
    });
  }
  return cells.sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
}

/** Case-insensitive substring match on label or key. */
export function filterParameters(cells: ParameterCell[], query: string): ParameterCell[] {
  const q = query.trim().toLowerCase();
  if (!q) return cells;
  return cells.filter((c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
}

export interface VehicleDetailsInput {
  vehicleId: string;
  summary: VehicleSummary | null;
  selected: SelectedVehicle | null;
  /** Server-corrected epoch ms. */
  now: number;
}

/** Whole panel view model (the components build the same sections separately, memoised). */
export function vehicleDetailsModel({
  vehicleId,
  summary,
  selected,
  now,
}: VehicleDetailsInput): VehicleDetailsView {
  const c = selected?.combinfo ?? null;
  const l = selected?.lafparsed ?? null;
  return {
    header: headerModel(vehicleId, summary, c, selected?.status ?? null, now),
    drivingEnergy: c && drivingEnergyModel(c, l),
    device: c && deviceModel(c),
    location: c && locationModel(c),
    parameters: l && parameterCells(l),
  };
}
