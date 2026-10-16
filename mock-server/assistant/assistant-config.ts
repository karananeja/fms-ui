/**
 * Assistant settings (F17 D-105/D-107, F21 D-134). Read per request from the environment, so tests
 * can switch modes without rebuilding the server. Empty values count as unset (`.env` copies of
 * `.env.example` leave them empty).
 *
 * Provider rules (`assistantEnv`):
 * - `FMS_ASSISTANT_FAKE=1` or `FMS_ASSISTANT_PROVIDER=fake` → the fake model. Its wire format is
 *   the provider's when `FMS_ASSISTANT_PROVIDER` is anthropic/openai/xai (the fake Messages API
 *   at `/__fake-anthropic`, or the fake chat-completions API at `/__fake-openai`), else Anthropic.
 * - `FMS_ASSISTANT_PROVIDER=anthropic|openai|xai` → that provider with its key
 *   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`), else `not-configured`.
 * - unset → the first provider whose key is set (anthropic → openai → xai); no key → the fake
 *   model in dev (`NODE_ENV !== 'production'` and `FMS_ASSISTANT_FAKE` unset) and
 *   `not-configured` otherwise.
 * - openai/xai need `FMS_ASSISTANT_MODEL` (no default model id) → else `not-configured`;
 *   anthropic defaults to `ASSISTANT_MODEL`.
 * `FMS_ASSISTANT_BASE_URL` overrides the API base URL in every mode.
 * A `not-configured` result carries a `reason` for the server log.
 */
export const ASSISTANT_MODEL = 'claude-opus-5-5';
export const ASSISTANT_EFFORT = 'medium' as const;
export const ASSISTANT_MAX_TOKENS = 16_000;
export const ASSISTANT_MAX_ITERATIONS = 8;
export const ASSISTANT_TIMEOUT_MS = 60_000;
/** F19 §8: the dashboard chat gets more steps and time per turn than the global chat. */
export const DASHBOARD_CHAT_MAX_ITERATIONS = 12;
export const DASHBOARD_CHAT_TIMEOUT_MS = 90_000;
/** Server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/**
 * Models that accept `fallbacks: "default"`; any other model (e.g. claude-haiku-5-5, picked in
 * AI settings) answers 400, so the request leaves the beta and the parameter out.
 */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
export const supportsFallback = (model: string) => FALLBACK_MODELS.has(model);
/** Path prefix of the fake Messages API (the SDK appends `/v1/messages`). */
export const FAKE_MODEL_PATH = '/__fake-anthropic';
/** Fake mode never needs a real key; the SDK still requires one to build headers. */
export const FAKE_API_KEY = 'fake-key';

/** Path prefix of the fake OpenAI-compatible API (the adapter appends `/chat/completions`). */
export const FAKE_OPENAI_PATH = '/__fake-openai/v1';
/** Model id sent to the fake OpenAI-compatible API when `FMS_ASSISTANT_MODEL` is unset. */
export const FAKE_OPENAI_MODEL = 'fake-model';

/** Real providers in auto-pick order (F21). */
export const PROVIDERS = ['anthropic', 'openai', 'xai'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const PROVIDER_KEY_VAR: Record<ProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
};

/** Default API base URLs of the OpenAI-compatible providers. */
export const DEFAULT_BASE_URL: Record<Exclude<ProviderName, 'anthropic'>, string> = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
};

/** F24 (D-141): xAI conversation-id header for cache routing (xAI prompt-caching docs). */
export const XAI_CONV_ID_HEADER = 'x-grok-conv-id';

/**
 * F24: ask xAI for usage on streamed replies (`stream_options.include_usage`). Not confirmed by
 * the xAI docs, so `FMS_XAI_STREAM_USAGE=0` turns it off. On by default.
 */
export const xaiStreamUsage = (env: NodeJS.ProcessEnv = process.env) =>
  env.FMS_XAI_STREAM_USAGE?.trim() !== '0';

/** F23/F24: `: ping` interval of the chat streams; `FMS_SSE_HEARTBEAT_MS` overrides it. */
export const SSE_HEARTBEAT_MS = 15_000;
export const sseHeartbeatMs = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.FMS_SSE_HEARTBEAT_MS?.trim());
  return Number.isFinite(n) && n > 0 ? n : SSE_HEARTBEAT_MS;
};

export type AssistantMode = 'real' | 'fake' | 'not-configured';

export interface AssistantEnv {
  mode: AssistantMode;
  /** Which API (wire format) is used; set unless `not-configured`. */
  provider?: ProviderName;
  apiKey?: string;
  /** Explicit base URL, or undefined for the default of the provider and mode. */
  baseURL?: string;
  model?: string;
  /** Why the assistant is not configured (logged once by the routes). */
  reason?: string;
}

export function assistantEnv(env: NodeJS.ProcessEnv = process.env): AssistantEnv {
  const val = (name: string) => env[name]?.trim() || undefined;
  const fake = val('FMS_ASSISTANT_FAKE');
  const baseURL = val('FMS_ASSISTANT_BASE_URL');
  const model = val('FMS_ASSISTANT_MODEL');
  const raw = val('FMS_ASSISTANT_PROVIDER')?.toLowerCase();
  const notConfigured = (reason: string): AssistantEnv => ({ mode: 'not-configured', reason });
  if (raw !== undefined && raw !== 'fake' && !(PROVIDERS as readonly string[]).includes(raw))
    return notConfigured(
      `FMS_ASSISTANT_PROVIDER="${raw}" is not one of xai, openai, anthropic, fake`,
    );
  const explicit = raw as ProviderName | 'fake' | undefined;

  const fakeEnv = (provider: ProviderName): AssistantEnv => ({
    mode: 'fake',
    provider,
    apiKey: FAKE_API_KEY,
    baseURL,
    model: model ?? (provider === 'anthropic' ? ASSISTANT_MODEL : FAKE_OPENAI_MODEL),
  });
  if (fake === '1' || explicit === 'fake')
    return fakeEnv(explicit && explicit !== 'fake' ? explicit : 'anthropic');

  const real = (provider: ProviderName): AssistantEnv => {
    const apiKey = val(PROVIDER_KEY_VAR[provider]);
    if (!apiKey)
      return notConfigured(
        `FMS_ASSISTANT_PROVIDER=${provider} but ${PROVIDER_KEY_VAR[provider]} is not set`,
      );
    if (provider !== 'anthropic' && !model)
      return notConfigured(
        `FMS_ASSISTANT_MODEL is required for the ${provider} provider (e.g. ${provider === 'xai' ? 'grok-4' : 'gpt-5'})`,
      );
    return { mode: 'real', provider, apiKey, baseURL, model: model ?? ASSISTANT_MODEL };
  };
  if (explicit) return real(explicit);
  const auto = PROVIDERS.find((p) => val(PROVIDER_KEY_VAR[p]));
  if (auto) return real(auto);
  if (fake === undefined && env.NODE_ENV !== 'production') return fakeEnv('anthropic');
  return notConfigured(
    fake === '0'
      ? 'FMS_ASSISTANT_FAKE=0 and no API key is set (ANTHROPIC_API_KEY, OPENAI_API_KEY or XAI_API_KEY)'
      : 'no API key is set (ANTHROPIC_API_KEY, OPENAI_API_KEY or XAI_API_KEY)',
  );
}

/** Whether the fake model endpoints are registered (dev, `FMS_ASSISTANT_FAKE=1`, provider `fake`). */
export const fakeModelAvailable = (dev: boolean, env: NodeJS.ProcessEnv = process.env) =>
  dev ||
  env.FMS_ASSISTANT_FAKE?.trim() === '1' ||
  env.FMS_ASSISTANT_PROVIDER?.trim().toLowerCase() === 'fake';

/** F25: user keys starting with this run on the fake model (when it is available). */
export const FAKE_USER_KEY_PREFIX = 'fake-';
export const isFakeUserKey = (key: string) => key.startsWith(FAKE_USER_KEY_PREFIX);

export type AssistantSource = 'user' | 'server' | 'none';
export type NotConfiguredReason = 'fallback_disabled' | 'server_not_configured' | 'no_models_enabled';

export interface ResolvedAssistant extends AssistantEnv {
  source: AssistantSource;
  /** Set when `source` is `none`. */
  notConfigured?: NotConfiguredReason;
}

/**
 * F25 (D-143) + F31 (D-171) resolution order: the default assistant when the user picked it and
 * the org allows it → the user's model (an enabled model of a readable key) → the server env
 * (F21 `assistantEnv`) only when the org allows the fallback → not configured. A fake user key
 * (`fake-…`) uses the fake model on that provider's wire format and never sends the user's key.
 */
export function resolveAssistant(opts: {
  userKey?: { provider: ProviderName; apiKey: string; model: string };
  allowFallback: boolean;
  fakeAvailable: boolean;
  /** F31: the user picked the default assistant in the chat picker. */
  preferServer?: boolean;
  /** F31: the user has keys but no enabled model (`no_models_enabled`). */
  hasKeys?: boolean;
  env?: NodeJS.ProcessEnv;
}): ResolvedAssistant {
  const { userKey } = opts;
  const server = (): ResolvedAssistant | undefined => {
    if (!opts.allowFallback) return undefined;
    const env = assistantEnv(opts.env);
    return env.mode === 'not-configured' ? undefined : { ...env, source: 'server' };
  };
  if (opts.preferServer) {
    const s = server();
    if (s) return s;
  }
  if (userKey) {
    const fake = opts.fakeAvailable && isFakeUserKey(userKey.apiKey);
    return {
      source: 'user',
      mode: fake ? 'fake' : 'real',
      provider: userKey.provider,
      apiKey: fake ? FAKE_API_KEY : userKey.apiKey,
      model: userKey.model,
    };
  }
  const s = server();
  if (s) return s;
  if (opts.hasKeys)
    return {
      source: 'none',
      mode: 'not-configured',
      notConfigured: 'no_models_enabled',
      reason: 'the user has keys but no enabled model',
    };
  if (!opts.allowFallback)
    return {
      source: 'none',
      mode: 'not-configured',
      notConfigured: 'fallback_disabled',
      reason: 'the user has no API key and the server key fallback is off',
    };
  const env = assistantEnv(opts.env);
  return { ...env, mode: 'not-configured', source: 'none', notConfigured: 'server_not_configured' };
}
