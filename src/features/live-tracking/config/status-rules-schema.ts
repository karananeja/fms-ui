import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import * as z from 'zod/mini';
import en from 'zod/v4/locales/en.js';
import type { StatusRulesConfig } from './status-rules-config.ts';

z.config(en());

const positive = () => z.number().check(z.positive(), z.refine(Number.isFinite, 'must be finite'));
const pid = z.string().check(z.minLength(1));

const prioritySchema = z.array(z.enum(VEHICLE_STATUSES)).check(
  z.superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const s of list) {
      if (seen.has(s)) ctx.addIssue({ code: 'custom', message: `duplicate status "${s}"` });
      seen.add(s);
    }
    for (const s of VEHICLE_STATUSES) {
      if (!seen.has(s)) ctx.addIssue({ code: 'custom', message: `missing status "${s}"` });
    }
    if (list.at(-1) !== 'stopped') {
      ctx.addIssue({ code: 'custom', message: '"stopped" must be last (it is the fallback)' });
    }
  }),
);

export const statusRulesSchema = z.strictObject({
  preferServerStatus: z.boolean(),
  priority: prioritySchema,
  thresholds: z.strictObject({
    nonCommMs: positive(),
    noGpsMs: positive(),
    pulloutVolts: positive(),
    runningSpeedKmh: positive(),
  }),
  immobilized: z.strictObject({ field: pid, equals: z.number() }),
  charging: z.strictObject({
    anyOf: z
      .array(
        z.union([
          z.strictObject({ pid, equals: z.number() }),
          z.strictObject({ pid, notEquals: z.number() }),
        ]),
      )
      .check(z.minLength(1)),
  }),
  sweepIntervalMs: positive(),
});

/** Validates the status rules; throws an `Error` listing every problem. */
export function parseStatusRulesConfig(cfg: unknown): StatusRulesConfig {
  const result = statusRulesSchema.safeParse(cfg);
  if (!result.success) {
    throw new Error(`Invalid status rules config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
