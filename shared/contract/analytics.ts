import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/** Analytics windows may span at most this many days; history covers the last 90 IST days. */
export const ANALYTICS_MAX_DAYS = 90;
/** IST (UTC+05:30, no DST): day buckets start at IST midnight. */
export const IST_OFFSET_MS = 330 * 60_000;

/** Additive daily aggregates; drive + idle + downtime = the bucket's length, uptime = drive + idle. */
export const KPI_FIELDS = [
  'distanceKm',
  'driveMs',
  'idleMs',
  'uptimeMs',
  'downtimeMs',
  'noGpsMs',
  'energyKwh',
  'chargeSessions',
  'breakdowns',
  'harshBrake',
  'harshAccel',
  'overspeed',
] as const;
export type KpiField = (typeof KPI_FIELDS)[number];

export const kpisSchema = z.object(
  Object.fromEntries(KPI_FIELDS.map((f) => [f, z.number().nonnegative()])) as Record<
    KpiField,
    z.ZodNumber
  >,
);
export type Kpis = z.infer<typeof kpisSchema>;
export type VehicleKpis = Kpis;

/**
 * Shared by every `/analytics/*` endpoint. Defaults: `to` = now, `from` = `to` − 30 days;
 * `to − from` ≤ 90 days. `fleetId` is a subtree (default: the caller's whole scope).
 * `sort` is a KPI field (or `score` for drivers), descending; append `:asc` to reverse.
 */
export const analyticsQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  fleetId: z.string().optional(),
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z]+(:asc|:desc)?$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const windowShape = { from: epochMsSchema, to: epochMsSchema, days: z.number().int().positive() };

export const analyticsSummarySchema = z.object({
  ...windowShape,
  vehicleCount: z.number().int().nonnegative(),
  kpis: kpisSchema,
  /** uptime / (uptime + downtime), 0–100. */
  uptimePct: z.number().min(0).max(100),
  /** (harshBrake + harshAccel + overspeed) per 100 km. */
  eventsPer100Km: z.number().nonnegative(),
  /** Driver score over the same window (see `driverScore`), `null` with no distance. */
  score: z.number().min(0).max(100).nullable(),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

export const vehicleRankingSchema = z.object({
  ...windowShape,
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({ vehicleId: z.string(), regno: z.string(), fleetId: z.string(), kpis: kpisSchema }),
  ),
});
export type VehicleRanking = z.infer<typeof vehicleRankingSchema>;

export const driverKpisSchema = z.object({
  driverId: z.string(),
  name: z.string(),
  fleetId: z.string(),
  kpis: kpisSchema,
  /** Vehicle-days driven (assignment-weighted). */
  vehicleDays: z.number().nonnegative(),
  score: z.number().min(0).max(100).nullable(),
});
export type DriverKpis = z.infer<typeof driverKpisSchema>;
export const driverRankingSchema = z.object({
  ...windowShape,
  total: z.number().int().nonnegative(),
  items: z.array(driverKpisSchema),
});

export const analyticsSeriesSchema = z.object({
  ...windowShape,
  points: z.array(
    z.object({
      /** IST date, `YYYY-MM-DD`. */
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      /** Start of the bucket (IST midnight, or `from` for the first one). */
      start: epochMsSchema,
      kpis: kpisSchema,
    }),
  ),
});
export type AnalyticsSeries = z.infer<typeof analyticsSeriesSchema>;

/** Weights per event in the driver score: 100 − Σ weight × events per 100 km, clamped to 0–100. */
export const SCORE_WEIGHTS = { harshBrake: 4, harshAccel: 3, overspeed: 6 } as const;

export function driverScore(k: Pick<Kpis, 'distanceKm' | keyof typeof SCORE_WEIGHTS>) {
  if (k.distanceKm <= 0) return null;
  const weighted =
    SCORE_WEIGHTS.harshBrake * k.harshBrake +
    SCORE_WEIGHTS.harshAccel * k.harshAccel +
    SCORE_WEIGHTS.overspeed * k.overspeed;
  return Math.round(Math.min(100, Math.max(0, 100 - (weighted / k.distanceKm) * 100)) * 10) / 10;
}
