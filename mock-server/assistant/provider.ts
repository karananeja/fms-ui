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

export interface ProviderTurn {
  /** Tool host of the turn (the tools emit their own `tool_*` / report / dashboard events). */
  host: ToolHost;
  messages: ChatMessage[];
  maxIterations: number;
  signal: AbortSignal;
  /** Called for every streamed text delta of every reply. */
  onText: (delta: string) => void;
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
  kind: 'timeout' | 'busy' | 'auth' | 'failed';
  status?: number;
}

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

/** The text of a message's content (blocks joined by a blank line). */
export const messageText = (m: ChatMessage) =>
  typeof m.content === 'string' ? m.content : m.content.map((b) => b.text).join('\n\n');
