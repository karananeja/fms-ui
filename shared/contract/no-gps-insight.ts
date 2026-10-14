import { z } from 'zod';
import { epochMsSchema } from './common.ts';
import { breakdownReasonSchema } from './requests.ts';

/** In priority order (first match wins). */
export const LIKELY_CAUSES = [
  'driver-reported',
  'device-offline',
  'device-battery-low',
  'weak-signal',
  'ignition-off',
  'unknown',
] as const;
export const likelyCauseSchema = z.enum(LIKELY_CAUSES);
export type LikelyCause = z.infer<typeof likelyCauseSchema>;

/** Thresholds behind the signals (F05 `nonCommMs` for `deviceOffline`). */
export const NO_GPS_SIGNAL_THRESHOLDS = {
  devBatteryLowVolts: 3.4,
  weakSignalDbm: -105,
} as const;

export const noGpsInsightSchema = z.object({
  vehicleId: z.string(),
  /** The last GPS fix (`gpstime`). */
  since: epochMsSchema,
  durationMs: z.number().int().nonnegative(),
  /** Reason on the vehicle's open breakdown request, if any. */
  reportedReason: breakdownReasonSchema.optional(),
  signals: z.object({
    devBatteryLow: z.boolean(),
    weakSignal: z.boolean(),
    ignitionOff: z.boolean(),
    deviceOffline: z.boolean(),
  }),
  likelyCause: likelyCauseSchema,
  /** One plain sentence. */
  explanation: z.string(),
});
export type NoGpsInsight = z.infer<typeof noGpsInsightSchema>;
