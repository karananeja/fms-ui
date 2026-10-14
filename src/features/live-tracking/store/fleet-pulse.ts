/** One "running" count observed at time `t` (ms). */
export interface PulseSample {
  t: number;
  v: number;
}

export const PULSE_INTERVAL_MS = 10_000;
export const PULSE_WINDOW_MS = 60 * 60_000;

/**
 * F08-R10: running-count samples since page load, at most one per `PULSE_INTERVAL_MS`, keeping
 * the last `PULSE_WINDOW_MS`. Returns the same array when no sample is due (cheap equality).
 */
export function addPulseSample(
  samples: readonly PulseSample[],
  t: number,
  v: number,
): readonly PulseSample[] {
  const last = samples.at(-1);
  if (last && t - last.t < PULSE_INTERVAL_MS) return samples;
  const from = t - PULSE_WINDOW_MS;
  let k = 0;
  while (k < samples.length && samples[k]!.t < from) k++;
  return [...samples.slice(k), { t, v }];
}

/** Change from the first to the last sample, in percent of the first; null below 2 samples. */
export function pulseChange(samples: readonly PulseSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!.v;
  const last = samples.at(-1)!.v;
  if (first === 0) return last === 0 ? 0 : null;
  return ((last - first) / first) * 100;
}
