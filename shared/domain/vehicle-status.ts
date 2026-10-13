/** Derived vehicle statuses (F05), in display order. Runtime-dependency free (safe in the worker). */
export const VEHICLE_STATUSES = [
  'running',
  'stopped',
  'immobilized',
  'non-comm',
  'charging',
  'pullout',
  'no-gps',
  'gps-never',
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

const STATUS_SET = new Set<string>(VEHICLE_STATUSES);

export const isVehicleStatus = (v: unknown): v is VehicleStatus =>
  typeof v === 'string' && STATUS_SET.has(v);
