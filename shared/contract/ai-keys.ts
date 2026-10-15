import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * F25 user-provided AI keys (D-143). Keys go browser → server only; every response carries the
 * masked form (`xai-…9f3c`). See docs/features/f25-user-api-keys/spec.md.
 */

export const AI_PROVIDERS = ['xai', 'openai', 'anthropic'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  xai: 'xAI Grok',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
};

/** Load models + Test connection calls per user per window (in memory, server side). */
export const KEY_CHECK_LIMIT = 5;
export const KEY_CHECK_WINDOW_MS = 60_000;

export const apiKeyInputSchema = z
  .string()
  .trim()
  .min(8, 'Enter the full API key')
  .max(512, 'That key is too long')
  .regex(/^[\x21-\x7e]+$/, 'An API key has no spaces or special characters');

export const aiModelIdSchema = z.string().trim().min(1, 'Choose a model').max(200);

export const aiKeySummarySchema = z.object({
  provider: aiProviderSchema,
  model: z.string(),
  /** Prefix + `…` + last 4 characters; the only key material ever returned. */
  masked: z.string(),
  /** The key the assistant uses for this user (one at most). */
  active: z.boolean(),
  /** False when the server can't decrypt it (secret changed or missing): save it again. */
  readable: z.boolean(),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
});
export type AiKeySummary = z.infer<typeof aiKeySummarySchema>;

export const ASSISTANT_SOURCES = ['user', 'server', 'none'] as const;
/** No user key and: the org turned the server-key fallback off / the server has no key either. */
export const NOT_CONFIGURED_REASONS = ['fallback_disabled', 'server_not_configured'] as const;

/** Who answers this user's chats (`GET /api/assistant/status`, chat header label). */
export const assistantStatusSchema = z.object({
  source: z.enum(ASSISTANT_SOURCES),
  provider: aiProviderSchema.nullable(),
  model: z.string().nullable(),
  /** The scripted fake model (dev / tests). */
  fake: z.boolean(),
  /** Set when `source` is `none`. */
  reason: z.enum(NOT_CONFIGURED_REASONS).nullable(),
});
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

export const aiKeysStateSchema = z.object({
  keys: z.array(aiKeySummarySchema),
  status: assistantStatusSchema,
  fallback: z.object({ allowed: z.boolean(), serverConfigured: z.boolean() }),
  /** False when the server has no usable `FMS_SECRET_KEY`: keys can't be saved. */
  storageAvailable: z.boolean(),
});
export type AiKeysState = z.infer<typeof aiKeysStateSchema>;

/** `POST /api/me/ai-keys/models`: without `apiKey`, the stored key of `provider` is used. */
export const aiModelsRequestSchema = z.strictObject({
  provider: aiProviderSchema,
  apiKey: apiKeyInputSchema.optional(),
});
export const aiModelsResponseSchema = z.object({ models: z.array(z.string()) });

export const aiKeyTestRequestSchema = z.strictObject({
  provider: aiProviderSchema,
  apiKey: apiKeyInputSchema.optional(),
  model: aiModelIdSchema,
});
export const aiKeyTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  models: z.array(z.string()),
});
export type AiKeyTestResult = z.infer<typeof aiKeyTestResultSchema>;

/** `PUT /api/me/ai-keys/:provider`: without `apiKey`, keeps the stored key (model / make active). */
export const saveAiKeySchema = z.strictObject({
  apiKey: apiKeyInputSchema.optional(),
  model: aiModelIdSchema,
});
export type SaveAiKeyInput = z.infer<typeof saveAiKeySchema>;

/** `GET|PUT /api/settings/ai` (`roles.manage`). */
export const aiSettingsSchema = z.object({
  allowServerKeyFallback: z.boolean(),
  serverConfigured: z.boolean(),
  serverProvider: aiProviderSchema.nullable(),
  serverModel: z.string().nullable(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const updateAiSettingsSchema = z.strictObject({ allowServerKeyFallback: z.boolean() });
