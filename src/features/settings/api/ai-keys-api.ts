import type {
  AiKeysState,
  AiProvider,
  AiSettings,
  AssistantChoiceInput,
  AssistantStatus,
} from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/**
 * F25 calls (D-143) + F31 enabled models (D-171). Keys only ever travel browser → server; every
 * response carries the masked form. Errors are `ApiError`: 409 `secret_missing`, 429
 * `rate_limited`, 422 `key_rejected` / `model_not_enabled`.
 */

interface Opts {
  signal?: AbortSignal;
}

export const getAiKeys = (opts: Opts = {}) =>
  apiFetch<AiKeysState>('/api/me/ai-keys', { signal: opts.signal });

/** Checks the key, loads its models and saves it (nothing enabled yet). */
export const saveAiKey = (provider: AiProvider, input: { apiKey: string }) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}`, { method: 'PUT', body: input });

export const refreshAiModels = (provider: AiProvider) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}/models/refresh`, { method: 'POST' });

export const setEnabledAiModels = (provider: AiProvider, enabled: string[]) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}/models`, {
    method: 'PUT',
    body: { enabled },
  });

export const removeAiKey = (provider: AiProvider) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}`, { method: 'DELETE' });

/** Chat header picker and the "not configured" check (assistant panel / dashboard dock). */
export const getAssistantStatus = (opts: Opts = {}) =>
  apiFetch<AssistantStatus>('/api/assistant/status', { signal: opts.signal });

/** F31: the model the user's next chat turns use (shared by both chats). */
export const chooseAssistantModel = (input: AssistantChoiceInput) =>
  apiFetch<AssistantStatus>('/api/me/ai-model', { method: 'PUT', body: input });

export const getAiSettings = (opts: Opts = {}) =>
  apiFetch<AiSettings>('/api/settings/ai', { signal: opts.signal });

export const updateAiSettings = (input: { allowServerKeyFallback: boolean }) =>
  apiFetch<AiSettings>('/api/settings/ai', { method: 'PUT', body: input });
