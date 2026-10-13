/** Vehicle details panel rules (F07). Thresholds are inclusive upper bounds. */
export const detailsConfig = {
  /** Freshness of GPS / CAN times by age: ≤ okMs → ok, ≤ warnMs → warn, else stale. */
  freshness: { okMs: 5 * 60_000, warnMs: 30 * 60_000 },
  /** SOC % colour bands: below `low` → stopped colour, below `mid` → warn, else ok. */
  socBands: { low: 20, mid: 60 },
  gauges: {
    speed: { min: 0, max: 220, ticks: [0, 44, 88, 132, 176, 220] },
    rpm: { min: 0, max: 12_000, ticks: [0, 2400, 4800, 7200, 9600, 12_000] },
  },
  /** Raw PID values meaning "not available". */
  naSentinels: [65535] as readonly number[],
  odoDigits: 7,
  /** Most fraction digits shown for raw parameter values. */
  paramMaxFractionDigits: 6,
};

export type DetailsConfig = typeof detailsConfig;
