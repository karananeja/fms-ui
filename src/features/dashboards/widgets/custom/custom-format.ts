import {
  datasetFields,
  type CustomSpec,
  type FieldDef,
  type ValueFormat,
} from '@shared/contract/widget-grammar.ts';
import { VEHICLE_STATUSES, type VehicleStatus } from '@shared/domain/vehicle-status.ts';
import type { Cell } from '@shared/domain/widget-shape.ts';
import { dayLabel, formatNum, istDate } from '@/features/analytics/lib/chart-scale';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';
import { formatIst } from '@/shared/lib/format-date';

/** F26: labels, colours and number formats of custom widgets (DS3 tokens only). */

export const CATEGORY_COLORS = [
  'var(--accent)',
  'var(--st-charging)',
  'var(--st-pullout)',
  'var(--st-stopped)',
  'var(--st-running)',
  'var(--st-immobilized)',
  'var(--st-noncomm)',
  'var(--st-nogps)',
];

const isStatus = (v: Cell): v is VehicleStatus =>
  typeof v === 'string' && (VEHICLE_STATUSES as readonly string[]).includes(v);

/** Colour of a category value: vehicle statuses keep their status colour. */
export function categoryColor(field: string | undefined, value: Cell, index: number): string {
  if (field === 'status' && isStatus(value)) return STATUS_META[value].color;
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;
}

export interface Labeller {
  fleetName(id: string): string;
}

/** Display text of a category / cell value of `field`. */
export function cellLabel(field: string | undefined, value: Cell, fd: FieldDef | undefined, l: Labeller): string {
  if (value === null || value === '') return '—';
  if (field === 'status' && isStatus(value)) return STATUS_META[value].label;
  if (fd?.type === 'fleet') return l.fleetName(String(value));
  if (fd?.type === 'time' && typeof value === 'number') return formatTime(value);
  if (typeof value === 'number') return formatValue(value, fd?.format, fd?.unit);
  return value;
}

export const formatTime = (t: number) => {
  const [date, time] = formatIst(t).split(' | ') as [string, string];
  return `${date} ${time.slice(0, 5)}`;
};

export function bucketLabel(t: number, bucket: 'hour' | 'day' | 'week'): string {
  const day = dayLabel(istDate(t));
  if (bucket === 'day') return day;
  if (bucket === 'week') return `w/c ${day}`;
  return `${day} ${formatIst(t).split(' | ')[1]!.slice(0, 5)}`;
}

/** `null` → "—"; durations are stored in ms and shown in hours. */
export function formatValue(v: number | null, format?: ValueFormat, unit?: string): string {
  if (v === null || v !== v) return '—';
  switch (format) {
    case 'duration':
      return `${formatNum(v / 3_600_000)} h`;
    case 'percent':
      return `${formatNum(v)}%`;
    case 'distance':
      return `${formatNum(v)} ${unit && unit !== 'h' ? unit : 'km'}`;
    case 'datetime':
      return formatTime(v);
    default:
      return unit && unit !== '%' ? `${formatNum(v)} ${unit}` : unit ? `${formatNum(v)}${unit}` : formatNum(v);
  }
}

/** Format + unit of the spec's value (mark overrides, else the aggregated field's). */
export function valueFormat(spec: CustomSpec): { format?: ValueFormat; unit?: string } {
  const fields = datasetFields(spec.data);
  const agg = spec.shape?.aggregate;
  const fd =
    agg && agg.op !== 'count' && agg.field
      ? fields[agg.field]
      : !agg && spec.mark.y
        ? fields[spec.mark.y]
        : undefined;
  return {
    format: spec.mark.format ?? fd?.format,
    unit: spec.mark.unit ?? (fd?.format === 'duration' ? undefined : fd?.unit),
  };
}
