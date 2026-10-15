import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages';
import {
  ASSISTANT_EFFORT,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MODEL,
  FALLBACK_BETA,
} from './assistant-config.ts';
import { buildTools } from './assistant-tools.ts';
import {
  emptyUsage,
  type ChatProvider,
  type ErrorClass,
  type ProviderResult,
  type ProviderTurn,
} from './provider.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';

/**
 * F17 path (D-105), unchanged by F21: the SDK beta tool runner with streaming, adaptive thinking,
 * the server-side refusal fallback and a cached prefix (system prompt + tools).
 */

/** The request parameters that make up the cached prefix (identical for every user). */
export function requestPrefix(model: string = ASSISTANT_MODEL) {
  return {
    model,
    max_tokens: ASSISTANT_MAX_TOKENS,
    thinking: { type: 'adaptive' as const },
    output_config: { effort: ASSISTANT_EFFORT },
    betas: [FALLBACK_BETA],
    fallbacks: 'default' as const,
    cache_control: { type: 'ephemeral' as const },
    tool_choice: { type: 'auto' as const },
    system: SYSTEM_PROMPT,
  };
}

export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly client: Anthropic,
    readonly model: string = ASSISTANT_MODEL,
  ) {}

  async run(turn: ProviderTurn): Promise<ProviderResult> {
    const usage = emptyUsage();
    let last: BetaMessage | undefined;
    let iterations = 0;
    const runner = this.client.beta.messages.toolRunner(
      {
        ...requestPrefix(this.model),
        tools: buildTools(turn.host),
        messages: turn.messages,
        max_iterations: turn.maxIterations,
        stream: true,
      },
      { signal: turn.signal },
    );
    for await (const stream of runner) {
      stream.on('text', turn.onText);
      last = await stream.finalMessage();
      iterations++;
      usage.inputTokens += last.usage.input_tokens;
      usage.outputTokens += last.usage.output_tokens;
      usage.cacheReadInputTokens += last.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationInputTokens += last.usage.cache_creation_input_tokens ?? 0;
    }
    if (!last) throw new Error('no message');
    return { stopReason: last.stop_reason ?? 'end_turn', iterations, usage };
  }

  classify(err: unknown): ErrorClass {
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { kind: 'timeout' };
    if (
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError ||
      (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)
    )
      return { kind: 'busy', status: err instanceof Anthropic.APIError ? err.status : undefined };
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    )
      return { kind: 'auth', status: err.status };
    return { kind: 'failed', status: err instanceof Anthropic.APIError ? err.status : undefined };
  }
}
