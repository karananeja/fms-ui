import { STATUS_META } from '../config/status-meta';
import type { PulseSample } from '../store/fleet-pulse';
import type { FilterOptions, VehicleFilter } from '../worker/worker-api';

// Pure helpers behind the F08 status bar components (kept out of the .tsx files for fast refresh).

// ---- status pills ----

const GAP = 6;
/** Room kept for the `+N` pill when not everything fits. */
export const MORE_WIDTH = 52;

/**
 * How many of the status pills (after ALL) fit in `available` px. `widths[0]` is ALL, which
 * always shows; when some pills don't fit, room for the `+N` pill is kept.
 */
export function fitCount(widths: readonly number[], available: number): number {
  const total = widths.reduce((a, w) => a + w, 0) + GAP * (widths.length - 1);
  if (total <= available) return widths.length - 1;
  let used = widths[0]! + GAP + MORE_WIDTH;
  let n = 0;
  for (let k = 1; k < widths.length; k++) {
    used += widths[k]! + GAP;
    if (used > available) break;
    n++;
  }
  return n;
}

// ---- fleet pulse ----

/** Sparkline box (px). */
export const SPARK = { w: 268, h: 46 } as const;
const W = SPARK.w;
const H = SPARK.h;

/** Scope label: the chosen fleet's name, `N FLEETS`, or `ALL FLEETS`. */
export function scopeLabel(fleetIds: readonly string[] | undefined, names: Map<string, string>) {
  if (!fleetIds?.length) return 'All fleets';
  if (fleetIds.length === 1) return names.get(fleetIds[0]!) ?? fleetIds[0]!;
  return `${fleetIds.length} fleets`;
}

/** SVG line + area paths for the samples, scaled to the box (flat when constant). */
export function sparkPaths(samples: readonly PulseSample[]): { line: string; area: string } {
  const t0 = samples[0]!.t;
  const span = Math.max(1, samples.at(-1)!.t - t0);
  const vs = samples.map((s) => s.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const y = (v: number) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8));
  const pts = samples.map((s) => `${(((s.t - t0) / span) * W).toFixed(1)} ${y(s.v).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  return { line, area: `${line} L${W} ${H} L0 ${H}Z` };
}

// ---- active chips ----

export interface FilterChip {
  key: string;
  label: string;
  /** The filter with this chip's value removed. */
  without: VehicleFilter;
}

const FIELD_LABEL = { all: 'Any', vin: 'VIN', regno: 'Reg', deviceId: 'Device' } as const;
const LISTS = [
  ['fleetIds', 'Fleet'],
  ['assetTypes', 'Type'],
  ['fuelTypes', 'Fuel'],
  ['makes', 'Make'],
  ['models', 'Model'],
] as const;

/** One chip per active value (statuses, fleets, types, SOC range, search). */
export function filterChips(f: VehicleFilter, fleetNames: Map<string, string>): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const s of f.statuses ?? []) {
    chips.push({
      key: `status:${s}`,
      label: STATUS_META[s].label,
      without: { ...f, statuses: f.statuses!.filter((x) => x !== s) },
    });
  }
  for (const [k, prefix] of LISTS) {
    for (const v of f[k] ?? []) {
      const name = k === 'fleetIds' ? (fleetNames.get(v) ?? v) : v;
      chips.push({
        key: `${k}:${v}`,
        label: `${prefix}: ${name}`,
        without: { ...f, [k]: f[k]!.filter((x) => x !== v) },
      });
    }
  }
  if (f.socMin !== undefined || f.socMax !== undefined) {
    chips.push({
      key: 'soc',
      label: `SOC ${f.socMin ?? 0}–${f.socMax ?? 100}%`,
      without: { ...f, socMin: undefined, socMax: undefined },
    });
  }
  if (f.search) {
    chips.push({
      key: 'search',
      label: `${FIELD_LABEL[f.search.field]}: ${f.search.prefix.toUpperCase()}…`,
      without: { ...f, search: undefined },
    });
  }
  return chips;
}

// ---- filter panel ----

/** The fields the panel edits (statuses and search live in the pills and the search box). */
export interface PanelDraft {
  fleetIds: string[];
  assetTypes: string[];
  fuelTypes: string[];
  makes: string[];
  models: string[];
  soc: [number, number];
}

export const draftFrom = (f: VehicleFilter): PanelDraft => ({
  fleetIds: [...(f.fleetIds ?? [])],
  assetTypes: [...(f.assetTypes ?? [])],
  fuelTypes: [...(f.fuelTypes ?? [])],
  makes: [...(f.makes ?? [])],
  models: [...(f.models ?? [])],
  soc: [f.socMin ?? 0, f.socMax ?? 100],
});

/** The current filter with the panel's fields replaced by the draft (models narrowed to makes). */
export function applyDraft(
  f: VehicleFilter,
  d: PanelDraft,
  options: FilterOptions | null,
): VehicleFilter {
  const allowed = d.makes.length
    ? new Set(options?.models.filter((m) => d.makes.includes(m.make)).map((m) => m.model))
    : null;
  return {
    ...f,
    fleetIds: d.fleetIds,
    assetTypes: d.assetTypes,
    fuelTypes: d.fuelTypes,
    makes: d.makes,
    models: allowed ? d.models.filter((m) => allowed.has(m)) : d.models,
    socMin: d.soc[0],
    socMax: d.soc[1],
  };
}

/** Number of panel-owned filter values (fleets, types, makes, models, SOC range). */
export function panelFilterCount(f: VehicleFilter): number {
  const lists = [f.fleetIds, f.assetTypes, f.fuelTypes, f.makes, f.models];
  return (
    lists.reduce((n, l) => n + (l?.length ?? 0), 0) +
    (f.socMin !== undefined || f.socMax !== undefined ? 1 : 0)
  );
}
