import { AI_PROVIDER_LABELS } from '@shared/contract/index.ts';
import {
  ASSISTANT_MODEL,
  DEFAULT_BASE_URL,
  FAKE_OPENAI_MODEL,
  isFakeUserKey,
  type ProviderName,
} from './assistant-config.ts';
import { isOutOfCredits } from './provider.ts';

/**
 * F25: lists the models a key can use (Load models / Test connection). Plain `fetch`, 10 s
 * timeout. Provider response bodies are never passed on (they can echo key fragments): every
 * failure becomes a `KeyCheckError` with a fixed message.
 */

export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100';
export const ANTHROPIC_VERSION = '2023-06-01';
export const MODEL_LIST_TIMEOUT_MS = 10_000;

/** Fake keys (`fake-…`) list these; a fake key containing `invalid` is rejected. */
export const FAKE_MODELS: Record<ProviderName, readonly string[]> = {
  anthropic: [ASSISTANT_MODEL, 'claude-fake-small'],
  openai: [FAKE_OPENAI_MODEL, 'fake-model-mini'],
  xai: [FAKE_OPENAI_MODEL, 'fake-model-mini'],
};

/** OpenAI lists every model; these are not chat models. */
const NON_CHAT = /embedding|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|sora/i;

export class KeyCheckError extends Error {
  constructor(
    readonly kind: 'rejected' | 'unreachable' | 'failed',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function listModels(
  provider: ProviderName,
  apiKey: string,
  opts: { fakeAvailable: boolean; fetch?: typeof fetch; timeoutMs?: number },
): Promise<string[]> {
  const label = AI_PROVIDER_LABELS[provider];
  if (opts.fakeAvailable && isFakeUserKey(apiKey)) {
    if (/invalid/i.test(apiKey))
      throw new KeyCheckError('rejected', `${label} rejected this key.`, 401);
    return [...FAKE_MODELS[provider]];
  }
  const url =
    provider === 'anthropic' ? ANTHROPIC_MODELS_URL : `${DEFAULT_BASE_URL[provider]}/models`;
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
      : { authorization: `Bearer ${apiKey}` };
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? MODEL_LIST_TIMEOUT_MS),
    });
  } catch {
    throw new KeyCheckError('unreachable', `Couldn't reach ${label}. Try again.`);
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    // The body is only tested, never passed on (see above).
    const body = await res.text().catch(() => '');
    if (isOutOfCredits(body))
      throw new KeyCheckError(
        'rejected',
        `${label} accepted this key, but the account is out of credits or over its spending limit.`,
        res.status,
      );
  }
  if (res.status === 401 || res.status === 403)
    throw new KeyCheckError('rejected', `${label} rejected this key.`, res.status);
  if (!res.ok)
    throw new KeyCheckError('failed', `${label} answered HTTP ${res.status}. Try again.`, res.status);
  let body: { data?: { id?: unknown }[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new KeyCheckError('failed', `${label} sent an unexpected answer.`);
  }
  const ids = (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .filter((id) => provider !== 'openai' || !NON_CHAT.test(id));
  return [...new Set(ids)].sort();
}
