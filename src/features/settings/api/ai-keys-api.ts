import type {
  AiKeysState,
  AiKeyTestResult,
  AiProvider,
  AiSettings,
  AssistantStatus,
} from '@shared/contract/index.ts';
import { apiFetch } from '@/shared/api/api-client';

/**
 * F25 calls (D-143). Keys only ever travel browser → server; every response carries the masked
 * form. Errors are `ApiError`: 409 `secret_missing`, 429 `rate_limited`, 422 `key_rejected`.
 */

interface Opts {
  signal?: AbortSignal;
}

export const getAiKeys = (opts: Opts = {}) =>
  apiFetch<AiKeysState>('/api/me/ai-keys', { signal: opts.signal });

export const listAiModels = (input: { provider: AiProvider; apiKey?: string }) =>
  apiFetch<{ models: string[] }>('/api/me/ai-keys/models', { method: 'POST', body: input });

export const testAiKey = (input: { provider: AiProvider; apiKey?: string; model: string }) =>
  apiFetch<AiKeyTestResult>('/api/me/ai-keys/test', { method: 'POST', body: input });

export const saveAiKey = (provider: AiProvider, input: { apiKey?: string; model: string }) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}`, { method: 'PUT', body: input });

export const removeAiKey = (provider: AiProvider) =>
  apiFetch<AiKeysState>(`/api/me/ai-keys/${provider}`, { method: 'DELETE' });

/** Chat header label and the "not configured" check (assistant panel / dashboard dock). */
export const getAssistantStatus = (opts: Opts = {}) =>
  apiFetch<AssistantStatus>('/api/assistant/status', { signal: opts.signal });

export const getAiSettings = (opts: Opts = {}) =>
  apiFetch<AiSettings>('/api/settings/ai', { signal: opts.signal });

export const updateAiSettings = (input: { allowServerKeyFallback: boolean }) =>
  apiFetch<AiSettings>('/api/settings/ai', { method: 'PUT', body: input });
