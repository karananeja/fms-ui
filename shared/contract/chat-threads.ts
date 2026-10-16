import { z } from 'zod';
import { chatThreadMessageSchema } from './assistant.ts';
import { epochMsSchema } from './common.ts';

/**
 * F28 (D-163…D-165): saved Ask FMS conversations, one thread per conversation, per user.
 * - `GET /api/chat/threads?q&before` → `ChatThreadList` (50 per page, newest `updatedAt` first)
 * - `GET /api/chat/threads/:id` → `ChatThreadDetail`
 * - `PATCH /api/chat/threads/:id` `{ title }` → `ChatThreadSummary` (`titleAuto: false`)
 * - `DELETE /api/chat/threads/:id` → 204
 * - `POST /api/chat/threads/:id/stop` → 204 once the stopped turn is saved
 * Every route answers only for the caller's own threads (another user's thread is 404).
 */

export const CHAT_THREADS_PER_USER = 200;
export const CHAT_THREAD_MESSAGES_MAX = 400;
export const CHAT_THREADS_PAGE = 50;
export const CHAT_THREAD_TITLE_MAX = 80;
export const CHAT_THREAD_PREVIEW_MAX = 80;
/** D-164: the panel opens the latest thread when it was updated within this window. */
export const CHAT_THREAD_RECENT_MS = 12 * 60 * 60_000;

export const chatThreadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** `false` once the user renamed it (the auto title never overwrites it). */
  titleAuto: z.boolean(),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
  /** The start of the last user message (≤ 80 chars). */
  preview: z.string(),
  /** D-165: older messages were dropped (400 per thread). */
  trimmed: z.boolean(),
});
export type ChatThreadSummary = z.infer<typeof chatThreadSummarySchema>;

export const chatThreadListSchema = z.object({
  items: z.array(chatThreadSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ChatThreadList = z.infer<typeof chatThreadListSchema>;

export const chatThreadListQuerySchema = z.object({
  q: z.string().max(60).optional(),
  before: z.string().max(200).optional(),
});
export type ChatThreadListQuery = z.infer<typeof chatThreadListQuerySchema>;

export const chatThreadDetailSchema = z.object({
  thread: chatThreadSummarySchema,
  messages: z.array(chatThreadMessageSchema),
});
export type ChatThreadDetail = z.infer<typeof chatThreadDetailSchema>;

export const renameChatThreadBodySchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a title')
    .max(CHAT_THREAD_TITLE_MAX, `At most ${CHAT_THREAD_TITLE_MAX} characters`),
});
export type RenameChatThreadBody = z.infer<typeof renameChatThreadBodySchema>;
