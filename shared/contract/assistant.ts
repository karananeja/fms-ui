import { z } from 'zod';
import { epochMsSchema } from './common.ts';
import {
  dashboardSchema,
  dashboardSummarySchema,
  threadMessageSchema,
  widgetPreviewSchema,
  widgetSchema,
  type WidgetInput,
} from './dashboards.ts';

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

/** `chat_busy` is pre-stream only (409: a turn is already running on that dashboard, F19). */
export const CHAT_ERROR_CODES = [
  'not_configured',
  'busy',
  'refusal',
  'timeout',
  'failed',
  'chat_busy',
] as const;

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
  /** F19: after every successful mutating dashboard tool call; `dashboard` is the full new state. */
  z.object({
    type: z.literal('dashboard_changed'),
    dashboardId: z.string(),
    changeId: z.string(),
    version: z.number().int().min(1),
    /** Chip text, e.g. "Added widget: Top idle vehicles". */
    label: z.string(),
    /** The turn's change summary so far. */
    summary: z.string(),
    dashboard: dashboardSchema,
  }),
  /** F19: `create_dashboard` succeeded (both chats). */
  z.object({
    type: z.literal('dashboard_created'),
    dashboard: dashboardSummarySchema,
    url: z.string(),
  }),
  /** D-135: `preview_widget` succeeded (both chats); the dashboard is unchanged. */
  z.object({ type: z.literal('widget_preview'), preview: widgetPreviewSchema }),
  /** F19 dashboard chat only: the stored user + assistant messages of this turn. */
  z.object({ type: z.literal('thread_saved'), messages: z.array(threadMessageSchema) }),
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

// ---- F19 dashboard chat ----

/** Mutating dashboard tool calls per turn (F19 §8). */
export const DASHBOARD_CHAT_MAX_MUTATIONS = 30;
/** F19 §3 tools that change a dashboard (their chips get the change style and Undo). */
export const DASHBOARD_MUTATING_TOOLS = [
  'add_widget',
  'arrange_widgets',
  'remove_widget',
  'rename_dashboard',
  'update_widget',
] as const;
/** D-135: non-mutating tool that proposes one widget as a preview card. */
export const PREVIEW_WIDGET_TOOL = 'preview_widget';
export const isDashboardMutatingTool = (name: string) =>
  (DASHBOARD_MUTATING_TOOLS as readonly string[]).includes(name);

/** Chips stored per assistant message. */
export const CHAT_CHIPS_MAX = 50;

/** `POST /api/dashboards/:id/chat`: only the new message; the server keeps the thread. */
export const dashboardChatRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(CHAT_MAX_CHARS),
});
export type DashboardChatRequest = z.infer<typeof dashboardChatRequestSchema>;

/** A dashboard created from a chat answer, with its page URL (`/dashboards/<id>`). */
export interface DashboardLink {
  summary: z.infer<typeof dashboardSummarySchema>;
  url: string;
}

/** A catalogue widget as the assistant writes it: no `id` (assigned by the server). */
export type WidgetToolInput = WidgetInput extends infer W
  ? W extends unknown
    ? Omit<W, 'id'>
    : never
  : never;

function withoutId(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema.options as z.ZodType[]).map(withoutId);
    return z.discriminatedUnion(
      schema.def.discriminator,
      options as unknown as [z.ZodObject, ...z.ZodObject[]],
    );
  }
  if (schema instanceof z.ZodObject) return schema.omit({ id: true });
  return schema;
}

/**
 * F19 §3 `widgetToolInput`: the F18 catalogue without `id`. Reference fields (`fleetId`,
 * `fleetIds`, `vehicleId`, `driverId`) may hold names/regnos; the tools resolve them to ids.
 */
export const widgetToolInputSchema = withoutId(widgetSchema) as z.ZodType<WidgetToolInput>;
