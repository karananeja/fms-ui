import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import { formatIst } from '@/shared/lib/format-date.ts';

/** F09-R7 column ids, in table order (Regno is the sticky first column). */
export const TABLE_COLUMN_IDS = [
  'regno',
  'vin',
  'deviceId',
  'fleet',
  'status',
  'speed',
  'soc',
  'dte',
  'odometer',
  'ignition',
  'gpstime',
  'canutctime',
  'location',
] as const;
export type TableColumnId = (typeof TABLE_COLUMN_IDS)[number];

/** One table row: the visible window only, plain values (`null` = no value). */
export interface TableRow {
  vehicleId: string;
  regno: string;
  vin: string;
  deviceId: string;
  fleetId: string;
  status: VehicleStatus | null;
  speed: number | null;
  soc: number | null;
  dte: number | null;
  odometer: number | null;
  /** 1 on, 0 off, null unknown. */
  ignition: number | null;
  gpstime: number | null;
  canutctime: number | null;
  lat: number | null;
  lng: number | null;
}

export interface TableColumn {
  id: TableColumnId;
  label: string;
  numeric: boolean;
  /** Shown by default on desktop / below 1024 px (F09-R12). */
  desktop: boolean;
  mobile: boolean;
}

export const TABLE_COLUMNS: readonly TableColumn[] = [
  { id: 'regno', label: 'Regno', numeric: false, desktop: true, mobile: true },
  { id: 'vin', label: 'VIN', numeric: false, desktop: true, mobile: false },
  { id: 'deviceId', label: 'Device ID', numeric: false, desktop: true, mobile: false },
  { id: 'fleet', label: 'Fleet', numeric: false, desktop: true, mobile: false },
  { id: 'status', label: 'Status', numeric: false, desktop: true, mobile: true },
  { id: 'speed', label: 'Speed (km/h)', numeric: true, desktop: true, mobile: false },
  { id: 'soc', label: 'SOC (%)', numeric: true, desktop: true, mobile: true },
  { id: 'dte', label: 'DTE (km)', numeric: true, desktop: true, mobile: false },
  { id: 'odometer', label: 'ODO (km)', numeric: true, desktop: true, mobile: false },
  { id: 'ignition', label: 'Ignition', numeric: false, desktop: true, mobile: false },
  { id: 'gpstime', label: 'Last GPS', numeric: false, desktop: true, mobile: false },
  { id: 'canutctime', label: 'Last CAN', numeric: false, desktop: true, mobile: false },
  { id: 'location', label: 'Location', numeric: false, desktop: true, mobile: false },
];

export const COLUMN_BY_ID = Object.fromEntries(TABLE_COLUMNS.map((c) => [c.id, c])) as Record<
  TableColumnId,
  TableColumn
>;

export type SortDir = 'asc' | 'desc';
export interface TableSort {
  column: TableColumnId;
  dir: SortDir;
}
export const DEFAULT_SORT: TableSort = { column: 'regno', dir: 'asc' };

/** Status labels without UI dependencies (the worker builds the CSV). Same text as STATUS_META. */
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

const fixed = (v: number | null, digits: number) => (v === null ? '' : v.toFixed(digits));

/**
 * Plain text of a cell, as exported (F09-R5): numbers ungrouped, timestamps in IST, empty when
 * there is no value. Fleets show their name.
 */
export function cellText(
  id: TableColumnId,
  row: TableRow,
  fleetNames: Readonly<Record<string, string>>,
): string {
  switch (id) {
    case 'regno':
    case 'vin':
    case 'deviceId':
      return row[id];
    case 'fleet':
      return fleetNames[row.fleetId] ?? row.fleetId;
    case 'status':
      return row.status ? STATUS_LABEL[row.status] : '';
    case 'speed':
    case 'soc':
    case 'dte':
      return fixed(row[id], 0);
    case 'odometer':
      return row.odometer === null ? '' : String(Math.floor(row.odometer));
    case 'ignition':
      return row.ignition === 1 ? 'On' : row.ignition === 0 ? 'Off' : '';
    case 'gpstime':
    case 'canutctime':
      return row[id] === null ? '' : formatIst(row[id]);
    case 'location':
      return row.lat === null || row.lng === null
        ? ''
        : `${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}`;
  }
}
