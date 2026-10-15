import type { ProviderName } from './assistant-config.ts';
import type { ToolHost } from './tool-kit.ts';

/**
 * F21 (D-134): what the runner needs from a model provider. A provider runs the whole multi-step
 * tool loop of one turn (stream a reply, run the requested tools, send the results back, repeat
 * up to `maxIterations` replies) and reports how it ended. The runner turns that into the same
 * browser-facing `ChatEvent`s for every provider.
 */

/** A text-only chat message (the transcript the runner hands to a provider). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  /** A string, or text blocks (the per-user `<context>` / `<dashboard>` blocks lead a user turn). */
  content: string | { type: 'text'; text: string }[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

/** F24: all input tokens of a run (uncached + read from cache + written to cache). */
export const totalInput = (u: Usage) =>
  u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;

export interface ProviderTurn {
  /** Tool host of the turn (the tools emit their own `tool_*` / report / dashboard events). */
  host: ToolHost;
  messages: ChatMessage[];
  maxIterations: number;
  signal: AbortSignal;
  /** Called for every streamed text delta of every reply. */
  onText: (delta: string) => void;
  /**
   * F24 (D-141): opaque, stable per user + chat (hashed). OpenAI sends it as `prompt_cache_key`,
   * xAI as the `x-grok-conv-id` header; Anthropic does not need it.
   */
  cacheKey?: string;
}

export interface ProviderResult {
  /**
   * `end_turn` | `max_tokens` | `refusal` | `tool_use` (the last reply still asked for tools: the
   * iteration cap was hit) | anything else the API reported.
   */
  stopReason: string;
  /** Replies streamed (API calls made). */
  iterations: number;
  usage: Usage;
}

/** How a thrown provider error maps to the chat error codes. */
export interface ErrorClass {
  /** `credits`: the provider account is out of credits or over its spending limit. */
  kind: 'timeout' | 'busy' | 'auth' | 'credits' | 'failed';
  status?: number;
}

/**
 * The provider's own wording for an exhausted account: OpenAI 429 `insufficient_quota` ("You
 * exceeded your current quota"), xAI 403 ("used all available credits or reached its monthly
 * spending limit"), Anthropic 400 ("Your credit balance is too low").
 */
export const isOutOfCredits = (message: string) =>
  /credits?\b|quota|spending limit|billing/i.test(message);

export const OUT_OF_CREDITS_MESSAGE =
  'The AI provider account is out of credits or over its spending limit. Ask an administrator.';

export interface ChatProvider {
  readonly name: ProviderName;
  readonly model: string;
  /** Runs one turn; throws on API / network errors and when `signal` aborts. */
  run(turn: ProviderTurn): Promise<ProviderResult>;
  classify(err: unknown): ErrorClass;
}

/** Thrown by fetch-based providers for HTTP errors from the API. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * F24: the provider's stream ended without a finish (no `[DONE]` / `finish_reason`). Classified
 * as `busy` (worth a retry); logged as the `provider-cut` end reason.
 */
export class ProviderCutError extends Error {
  constructor(message = 'the provider stream ended before the reply finished') {
    super(message);
  }
}

/** The text of a message's content (blocks joined by a blank line). */
export const messageText = (m: ChatMessage) =>
  typeof m.content === 'string' ? m.content : m.content.map((b) => b.text).join('\n\n');
