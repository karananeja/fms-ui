import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * F30 AI token usage monitor: one `ai_usage` row per model run (global chat, dashboard chat,
 * Retry, auto-title). Costs are estimates from a price table in code; a model without a price
 * is "tokens only" (`costUsd: null`). Fake-model runs are hidden unless `includeFake=1`.
 */

export const USAGE_RANGES = ['7d', '30d', '90d'] as const;
export const usageRangeSchema = z.enum(USAGE_RANGES);
export type UsageRange = z.infer<typeof usageRangeSchema>;
export const USAGE_RANGE_DAYS: Record<UsageRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const USAGE_CHATS = ['global', 'dashboard', 'title'] as const;
export const usageChatSchema = z.enum(USAGE_CHATS);
export type UsageChat = z.infer<typeof usageChatSchema>;

export const USAGE_SOURCES = ['user', 'server', 'fake'] as const;
export const usageSourceSchema = z.enum(USAGE_SOURCES);
export type UsageSource = z.infer<typeof usageSourceSchema>;

const flag = z
  .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
  .optional()
  .transform((v) => v === '1' || v === 'true');

/** `GET /api/me/usage` query. */
export const usageQuerySchema = z.object({
  range: usageRangeSchema.default('30d'),
  includeFake: flag,
});
export type UsageQuery = z.infer<typeof usageQuerySchema>;

/** `GET /api/admin/usage` and `/api/admin/usage.csv` query. */
export const adminUsageQuerySchema = usageQuerySchema.extend({
  userId: z.string().min(1).max(100).optional(),
  provider: z.string().min(1).max(50).optional(),
});
export type AdminUsageQuery = z.infer<typeof adminUsageQuerySchema>;

export const usageTotalsSchema = z.object({
  turns: z.number().int().nonnegative(),
  /** Uncached input tokens. */
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /** cache read / (input + cache read + cache write); null with no input at all. */
  cacheHitRate: z.number().min(0).max(1).nullable(),
  /** Estimated USD of the priced runs; null when none of the runs has a price. */
  costUsd: z.number().nonnegative().nullable(),
  /** Runs of models with no price on file (tokens only). */
  unpricedTurns: z.number().int().nonnegative(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const usageDaySchema = usageTotalsSchema.extend({
  /** IST date `YYYY-MM-DD`. */
  day: z.string(),
});
export type UsageDay = z.infer<typeof usageDaySchema>;

export const usageByModelSchema = usageTotalsSchema.extend({
  provider: z.string(),
  model: z.string(),
  /** The model has a price on file. */
  priced: z.boolean(),
});
export type UsageByModel = z.infer<typeof usageByModelSchema>;

export const usageByChatSchema = usageTotalsSchema.extend({ chat: usageChatSchema });
export type UsageByChat = z.infer<typeof usageByChatSchema>;

export const usageByUserSchema = usageTotalsSchema.extend({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
});
export type UsageByUser = z.infer<typeof usageByUserSchema>;

export const usageTurnSchema = z.object({
  id: z.string(),
  userId: z.string(),
  at: epochMsSchema,
  chat: usageChatSchema,
  threadId: z.string().nullable(),
  dashboardId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  source: usageSourceSchema,
  steps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outcome: z.string(),
  costUsd: z.number().nonnegative().nullable(),
});
export type UsageTurn = z.infer<typeof usageTurnSchema>;

/** `GET /api/me/usage` and (with `byUser`) `GET /api/admin/usage`. */
export const usageReportSchema = z.object({
  range: usageRangeSchema,
  /** IST midnight of the first day of the range. */
  from: epochMsSchema,
  to: epochMsSchema,
  includeFake: z.boolean(),
  /** Fixed windows, whatever the range: today, last 7 and 30 IST days. */
  summary: z.object({
    today: usageTotalsSchema,
    d7: usageTotalsSchema,
    d30: usageTotalsSchema,
  }),
  /** Totals over the selected range. */
  totals: usageTotalsSchema,
  daily: z.array(usageDaySchema),
  byModel: z.array(usageByModelSchema),
  byChat: z.array(usageByChatSchema),
  /** The 10 most expensive runs in the range (by cost, then tokens). */
  topTurns: z.array(usageTurnSchema),
  /** Admin only. */
  byUser: z.array(usageByUserSchema).optional(),
  /** Date the price table was checked. */
  pricesChecked: z.string(),
});
export type UsageReport = z.infer<typeof usageReportSchema>;

/** Header of `GET /api/admin/usage.csv`. */
export const USAGE_CSV_HEADER = [
  'at_ist',
  'user_email',
  'chat',
  'thread_id',
  'dashboard_id',
  'provider',
  'model',
  'source',
  'steps',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'outcome',
  'est_cost_usd',
] as const;
