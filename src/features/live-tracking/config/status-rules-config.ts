import { COMBINFO_LIVE_FIELDS } from '@shared/contract/ws-protocol.ts';
import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';

export type PidCondition = { pid: string } & ({ equals: number } | { notEquals: number });

export interface StatusRulesConfig {
  /** Use the row's `displayStatus` when present and valid. */
  preferServerStatus: boolean;
  /** Evaluation order, first match wins; `stopped` is the last entry and the fallback. */
  priority: readonly VehicleStatus[];
  thresholds: {
    /** now − utctime > this → non-comm */
    nonCommMs: number;
    /** now − gpstime > this → no-gps */
    noGpsMs: number;
    /** carbattery < this → pullout */
    pulloutVolts: number;
    /** speed > this (and ignition on) → running */
    runningSpeedKmh: number;
  };
  immobilized: { field: string; equals: number };
  /** Any-of; a PID that has not arrived yet (null) never matches. */
  charging: { anyOf: readonly PidCondition[] };
  sweepIntervalMs: number;
}

/** The one place to change status rules (D-015). Validated when the worker starts. */
export const statusRulesConfig = {
  preferServerStatus: true,
  priority: [
    'gps-never',
    'non-comm',
    'pullout',
    'immobilized',
    'charging',
    'no-gps',
    'running',
    'stopped',
  ],
  thresholds: {
    nonCommMs: 30 * 60_000,
    noGpsMs: 10 * 60_000,
    pulloutVolts: 1.0,
    runningSpeedKmh: 2,
  },
  immobilized: { field: 'immobilization_status', equals: 1 },
  charging: {
    anyOf: [
      { pid: 'mcu_charge_plug_status', equals: 1 },
      { pid: 'charger_status', notEquals: 0 },
    ],
  },
  sweepIntervalMs: 1000,
} satisfies StatusRulesConfig;

const COMBINFO_FIELDS = new Set<string>(COMBINFO_LIVE_FIELDS);

/** Fleet-scope lafparsed PIDs the rules need: charging PIDs, plus the immobilized field if it is not a combinfo field. */
export function statusLafPids(cfg: StatusRulesConfig): string[] {
  const pids = cfg.charging.anyOf.map((c) => c.pid);
  if (!COMBINFO_FIELDS.has(cfg.immobilized.field)) pids.push(cfg.immobilized.field);
  return [...new Set(pids)];
}
