import { HEARTBEAT_MS } from '@shared/contract/ws-protocol.ts';

export const liveTrackingConfig = {
  /** Max worker → main-thread pushes per second. */
  pushHz: 4,
  backoffBaseMs: 500,
  backoffMaxMs: 30_000,
  /** Silence after which the socket is considered dead. */
  heartbeatTimeoutMs: 2 * HEARTBEAT_MS,
  /** Fleet-scope lafparsed PIDs (F05 derives these from the status rules). */
  fleetLafPids: ['mcu_charge_plug_status', 'charger_status'] as readonly string[],
  /** Latest lafparsed row per unknown device, waiting for its combinfo row. */
  pendingLafMax: 20_000,
  pendingLafTtlMs: 60_000,
  initialCapacity: 1024,
  statsIntervalMs: 1000,
};

export type LiveTrackingConfig = typeof liveTrackingConfig;
