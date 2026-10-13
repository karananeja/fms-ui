/** WS protocol constants with no runtime dependencies (safe to import in the worker). */
export const WS_PATH = '/ws/live';
export const WS_CLOSE = { unauthenticated: 4401, forbidden: 4403, gone: 4410 } as const;
export const HEARTBEAT_MS = 15_000;

/** Fleet-scope `combinfo` columns. Deltas carry `vehicleId` + live fields only. */
export const COMBINFO_META_FIELDS = [
  'vehicleId',
  'deviceId',
  'regno',
  'vin',
  'fleetId',
  'assetType',
  'fuelType',
  'make',
  'model',
  'variant',
] as const;
export const COMBINFO_LIVE_FIELDS = [
  'lat',
  'lng',
  'speed',
  'heading',
  'ignstatus',
  'carbattery',
  'devbattery',
  'fixquality',
  'utctime',
  'gpstime',
  'canutctime',
  'soc',
  'dte',
  'odometer',
  'immobilization_status',
] as const;
export const COMBINFO_SNAPSHOT_FIELDS = [...COMBINFO_META_FIELDS, ...COMBINFO_LIVE_FIELDS];
export const COMBINFO_DELTA_FIELDS = ['vehicleId', ...COMBINFO_LIVE_FIELDS];
/** Sent when a vehicle leaves the subscription's scope (`fleetId` is `null`). */
export const COMBINFO_LEAVE_FIELDS = ['vehicleId', 'fleetId'];
export const LAFPARSED_BASE_FIELDS = ['deviceId', 'canutctime'] as const;
