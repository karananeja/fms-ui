import { z } from 'zod';
import { epochMsSchema } from './common.ts';

/**
 * F25 user-provided AI keys (D-143) + F31 enabled models (D-171). Keys go browser → server only;
 * every response carries the masked form (`xai-…9f3c`). A key carries the provider's model list
 * and the models the user enabled; chats can only use an enabled model (or the default
 * assistant). See docs/features/f25-user-api-keys/spec.md and f31-enabled-models/spec.md.
 */

export const AI_PROVIDERS = ['xai', 'openai', 'anthropic'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  xai: 'xAI Grok',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
};

/** Key checks (Save key + Refresh models) per user per window (in memory, server side). */
export const KEY_CHECK_LIMIT = 5;
export const KEY_CHECK_WINDOW_MS = 60_000;
/** F31: enabled models per key. */
export const MAX_ENABLED_MODELS = 20;
/** F31: provider model ids stored per key. */
export const MAX_AVAILABLE_MODELS = 500;

export const apiKeyInputSchema = z
  .string()
  .trim()
  .min(8, 'Enter the full API key')
  .max(512, 'That key is too long')
  .regex(/^[\x21-\x7e]+$/, 'An API key has no spaces or special characters');

export const aiModelIdSchema = z.string().trim().min(1, 'Choose a model').max(200);

export const aiKeySummarySchema = z.object({
  provider: aiProviderSchema,
  /** Prefix + `…` + last 4 characters; the only key material ever returned. */
  masked: z.string(),
  /** False when the server can't decrypt it (secret changed or missing): save it again. */
  readable: z.boolean(),
  /** F31: the provider's model ids, from the last Save / Refresh. */
  availableModels: z.array(z.string()),
  /** F31: the models the user enabled (in the order ticked); only these can be used. */
  enabledModels: z.array(z.string()),
  modelsFetchedAt: epochMsSchema.nullable(),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
});
export type AiKeySummary = z.infer<typeof aiKeySummarySchema>;

export const ASSISTANT_SOURCES = ['user', 'server', 'none'] as const;
/**
 * No usable user model and: the org turned the server-key fallback off / the server has no key
 * either / (F31) keys exist but none has an enabled model.
 */
export const NOT_CONFIGURED_REASONS = [
  'fallback_disabled',
  'server_not_configured',
  'no_models_enabled',
] as const;

/** F31: one model the chat picker offers. */
export const aiModelChoiceSchema = z.object({ provider: aiProviderSchema, model: z.string() });
export type AiModelChoice = z.infer<typeof aiModelChoiceSchema>;

/** Who answers this user's chats (`GET /api/assistant/status`, chat header picker). */
export const assistantStatusSchema = z.object({
  source: z.enum(ASSISTANT_SOURCES),
  provider: aiProviderSchema.nullable(),
  model: z.string().nullable(),
  /** The scripted fake model (dev / tests). */
  fake: z.boolean(),
  /** Set when `source` is `none`. */
  reason: z.enum(NOT_CONFIGURED_REASONS).nullable(),
  /** F31: enabled models of the user's readable keys, in provider order. */
  options: z.array(aiModelChoiceSchema),
  /** F31: the default assistant (server key), when the org allows it. */
  serverOption: aiModelChoiceSchema.nullable(),
});
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

export const aiKeysStateSchema = z.object({
  keys: z.array(aiKeySummarySchema),
  status: assistantStatusSchema,
  fallback: z.object({ allowed: z.boolean(), serverConfigured: z.boolean() }),
  /** False when the server has no usable `FMS_SECRET_KEY`: keys can't be saved. */
  storageAvailable: z.boolean(),
  /** F31: set after a Save whose model list couldn't be loaded ("try Refresh"). */
  notice: z.string().optional(),
});
export type AiKeysState = z.infer<typeof aiKeysStateSchema>;

/** `PUT /api/me/ai-keys/:provider` (F31): the key only; the server loads its models. */
export const saveAiKeySchema = z.strictObject({ apiKey: apiKeyInputSchema });
export type SaveAiKeyInput = z.infer<typeof saveAiKeySchema>;

/** `PUT /api/me/ai-keys/:provider/models` (F31). */
export const enableAiModelsSchema = z.strictObject({
  enabled: z.array(aiModelIdSchema).max(MAX_ENABLED_MODELS, `Up to ${MAX_ENABLED_MODELS} models`),
});
export type EnableAiModelsInput = z.infer<typeof enableAiModelsSchema>;

/** `PUT /api/me/ai-model` (F31): one enabled model, or the default assistant. */
export const assistantChoiceInputSchema = z.union([
  z.strictObject({ provider: aiProviderSchema, model: aiModelIdSchema }),
  z.strictObject({ source: z.literal('server') }),
]);
export type AssistantChoiceInput = z.infer<typeof assistantChoiceInputSchema>;

/** `GET|PUT /api/settings/ai` (`roles.manage`). */
export const aiSettingsSchema = z.object({
  allowServerKeyFallback: z.boolean(),
  serverConfigured: z.boolean(),
  serverProvider: aiProviderSchema.nullable(),
  serverModel: z.string().nullable(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const updateAiSettingsSchema = z.strictObject({ allowServerKeyFallback: z.boolean() });
