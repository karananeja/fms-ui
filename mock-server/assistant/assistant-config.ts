/**
 * F17 assistant settings (D-105, D-107). Read per request from the environment, so tests can
 * switch modes without rebuilding the server.
 *
 * Mode rules:
 * - `FMS_ASSISTANT_FAKE=1` → fake model (the in-process fake Messages API, D-107).
 * - `FMS_ASSISTANT_FAKE=0` → the real API if `ANTHROPIC_API_KEY` is set, else `not-configured`.
 * - unset → the real API if `ANTHROPIC_API_KEY` is set; otherwise the fake model in dev
 *   (`NODE_ENV !== 'production'`, so dev and e2e work out of the box) and `not-configured` in
 *   production.
 * `FMS_ASSISTANT_BASE_URL` overrides the Messages API base URL in either mode (default: the
 * Anthropic API for real mode, this server's own `/__fake-anthropic` route for fake mode).
 */
export const ASSISTANT_MODEL = 'claude-opus-5-5';
export const ASSISTANT_EFFORT = 'medium' as const;
export const ASSISTANT_MAX_TOKENS = 16_000;
export const ASSISTANT_MAX_ITERATIONS = 8;
export const ASSISTANT_TIMEOUT_MS = 60_000;
/** Server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Path prefix of the fake Messages API (the SDK appends `/v1/messages`). */
export const FAKE_MODEL_PATH = '/__fake-anthropic';
/** Fake mode never needs a real key; the SDK still requires one to build headers. */
export const FAKE_API_KEY = 'fake-key';

export type AssistantMode = 'real' | 'fake' | 'not-configured';

export interface AssistantEnv {
  mode: AssistantMode;
  apiKey?: string;
  /** Explicit base URL, or undefined for the default of the mode. */
  baseURL?: string;
}

export function assistantEnv(env: NodeJS.ProcessEnv = process.env): AssistantEnv {
  const key = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const fake = env.FMS_ASSISTANT_FAKE;
  const baseURL = env.FMS_ASSISTANT_BASE_URL?.trim() || undefined;
  if (fake === '1') return { mode: 'fake', apiKey: FAKE_API_KEY, baseURL };
  if (key) return { mode: 'real', apiKey: key, baseURL };
  if (fake === undefined && env.NODE_ENV !== 'production')
    return { mode: 'fake', apiKey: FAKE_API_KEY, baseURL };
  return { mode: 'not-configured' };
}
