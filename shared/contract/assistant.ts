import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * F17 fleet assistant: `POST /api/chat` takes the whole transcript (text only, ≤ 30 turns, oldest
 * dropped first) and streams Server-Sent Events, one JSON `ChatEvent` per `data:` line.
 * `GET /api/chat/reports/:id` downloads a generated report (15 min).
 */

export const CHAT_MAX_TURNS = 30;
export const CHAT_MAX_CHARS = 4000;
export const REPORT_TTL_MS = 15 * 60_000;

export const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

/** The last turn must be the user's question. */
export const chatRequestSchema = z.object({
  messages: z
    .array(chatTurnSchema)
    .min(1)
    .max(CHAT_MAX_TURNS)
    .refine((m) => m.at(-1)?.role === 'user', { message: 'The last turn must be from the user' })
    .refine(
      (m) => {
        const q = m.at(-1)?.content ?? '';
        return q.trim().length > 0 && q.length <= CHAT_MAX_CHARS;
      },
      {
        message: `The question must be 1–${CHAT_MAX_CHARS} characters`,
      },
    ),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const REPORT_KINDS = [
  'vehicle-status',
  'utilisation',
  'driver-performance',
  'no-gps',
  'requests',
] as const;
export const reportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof reportKindSchema>;

export const reportDescriptorSchema = z.object({
  id: z.string(),
  kind: reportKindSchema,
  format: z.enum(['csv', 'pdf']),
  filename: z.string(),
  rows: z.number().int().nonnegative(),
  /** `GET` this (same origin, session cookie) to download. */
  url: z.string(),
  expiresAt: epochMsSchema,
});
export type ReportDescriptor = z.infer<typeof reportDescriptorSchema>;

/** A vehicle or driver mentioned in the answer; the client links `label` occurrences. */
export const entityRefSchema = z.object({
  kind: z.enum(['vehicle', 'driver']),
  id: z.string(),
  /** Regno or driver name as it appears in the text. */
  label: z.string(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const CHAT_ERROR_CODES = ['not_configured', 'busy', 'refusal', 'timeout', 'failed'] as const;

export const chatEventSchema = z.discriminatedUnion('type', [
  /** Streamed answer text. */
  z.object({ type: z.literal('text'), delta: z.string() }),
  /** A tool started; `label` is user-facing, e.g. "Looking up MH12AB1234…". */
  z.object({ type: z.literal('tool_start'), id: z.string(), name: z.string(), label: z.string() }),
  /** A tool finished; `ok: false` for errors / not permitted / not found. */
  z.object({
    type: z.literal('tool_end'),
    id: z.string(),
    ok: z.boolean(),
    summary: z.string().optional(),
  }),
  z.object({ type: z.literal('report'), report: reportDescriptorSchema }),
  z.object({ type: z.literal('entities'), items: z.array(entityRefSchema) }),
  /** Ends the stream (no `done` follows). */
  z.object({ type: z.literal('error'), code: z.enum(CHAT_ERROR_CODES), message: z.string() }),
  z.object({
    type: z.literal('done'),
    stopReason: z.string(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadInputTokens: z.number(),
        cacheCreationInputTokens: z.number(),
      })
      .optional(),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
