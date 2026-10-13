import { z } from 'zod';
import { epochMsSchema } from './common.ts';

export const mailSchema = z.object({
  to: z.string(),
  kind: z.enum(['reset-password', 'invite']),
  subject: z.string(),
  url: z.string(),
  token: z.string(),
  sentAt: epochMsSchema,
});
export type Mail = z.infer<typeof mailSchema>;
export const mailboxSchema = z.array(mailSchema);

export const setClockSchema = z.object({ offsetMs: z.number().int() });
export const clockSchema = z.object({ offsetMs: z.number().int(), now: epochMsSchema });

export const healthSchema = z.object({ ok: z.literal(true) });

export const statsSchema = z.object({
  vehicles: z.number().int(),
  sockets: z.number().int(),
  subscriptions: z.number().int(),
  cpuUserMs: z.number(),
  cpuSystemMs: z.number(),
  uptimeMs: z.number(),
  rssBytes: z.number(),
  heapUsedBytes: z.number(),
});
export type Stats = z.infer<typeof statsSchema>;
