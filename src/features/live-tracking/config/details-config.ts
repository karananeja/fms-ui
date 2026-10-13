/** Vehicle details panel rules (F07 rev 3). Thresholds are inclusive upper bounds. */
export const detailsConfig = {
  /** Freshness of GPS / CAN times by age: ≤ okMs → ok, ≤ warnMs → warn, else stale. */
  freshness: { okMs: 5 * 60_000, warnMs: 30 * 60_000 },
  /** SOC % colour bands: below `low` → danger, below `mid` → warn, else ok. */
  socBands: { low: 20, mid: 60 },
  /** SOH % at or above this is healthy. */
  sohOk: 80,
  /** Range ring full scale (km). */
  rangeRingMax: 150,
  /** Speedometer: 0–max km/h, minor tick every `tick`, label every `label`, red above `redFrom`. */
  speedo: { max: 120, tick: 5, label: 20, redFrom: 90 },
  /** Signal bars by `rxdbm`: ≥ each threshold adds a bar (3 bars max of 4 drawn). */
  signalBars: [-100, -85, -70] as readonly number[],
  /** Selected-vehicle session buffer (worker). */
  historyMs: 2 * 60 * 60_000,
  /** Trail window fetched on select (minutes). */
  trailMinutes: 60,
  /** Parameter group chips: key predicates. */
  parameterGroups: [
    { id: 'all', label: 'ALL', match: null },
    { id: 'bms', label: 'BMS', match: { prefix: 'bms_' } },
    { id: 'mcu', label: 'MCU', match: { prefix: 'mcu_' } },
    { id: 'cells', label: 'CELLS', match: { prefix: 'cell_' } },
    { id: 'charger', label: 'CHARGER', match: { prefix: 'charger_' } },
    { id: 'faults', label: 'FAULTS', match: { includes: 'fault' } },
  ] as const,
  /** Highlight tiles above the parameter list. */
  highlightPids: ['battery_voltage', 'bms_chargingcycles', 'afe_temperature', 'ah_throughput'],
  /** Cell strip keys: `cell_voltage_01…NN`. */
  cellCount: 20,
  /** Raw PID values meaning "not available". */
  naSentinels: [65535] as readonly number[],
  /** Most fraction digits shown for raw parameter values. */
  paramMaxFractionDigits: 6,
};

export type DetailsConfig = typeof detailsConfig;
export type ParameterGroupId = (typeof detailsConfig.parameterGroups)[number]['id'];
