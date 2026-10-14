import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import type { ChatEvent, ChatTurn } from '@shared/contract/index.ts';
import {
  ASSISTANT_EFFORT,
  ASSISTANT_MAX_ITERATIONS,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MODEL,
  FALLBACK_BETA,
} from './assistant-config.ts';
import { buildTools, type ToolHost } from './assistant-tools.ts';
import { SYSTEM_PROMPT, userContext, type UserContext } from './system-prompt.ts';

/**
 * F17 run of one question (D-105): the SDK tool runner with streaming, forwarding text deltas,
 * tool start/end, reports and entity refs as `ChatEvent`s. Never throws: every outcome ends
 * with exactly one `done` or `error` event (none if the client went away).
 */

export interface RunOptions {
  client: Anthropic;
  host: Omit<ToolHost, 'emit' | 'entities'>;
  context: UserContext;
  turns: ChatTurn[];
  emit: (event: ChatEvent) => void;
  signal: AbortSignal;
  /** Why `signal` fired: the 60 s timeout, or the client closing the connection. */
  abortReason: () => 'timeout' | 'client' | undefined;
  log: (msg: string, data?: object) => void;
  maxIterations?: number;
}

export const REFUSAL_MESSAGE =
  "Sorry, I can't help with that. I can answer questions about your vehicles, drivers, requests and reports.";
export const BUSY_MESSAGE = 'Assistant is busy, try again in a moment.';
const iterationNote = (n: number) =>
  `\n\nI stopped after ${n} steps without finishing. Try a narrower question.`;

/** Client turns → API messages; the per-user context is the first block of the first user turn. */
export function toApiMessages(turns: ChatTurn[], context: UserContext): BetaMessageParam[] {
  const first = turns.findIndex((t) => t.role === 'user');
  return turns.slice(first).map((t, k) =>
    k === 0
      ? {
          role: 'user',
          content: [
            { type: 'text', text: userContext(context) },
            { type: 'text', text: t.content },
          ],
        }
      : { role: t.role, content: t.content },
  );
}

/** The request parameters that make up the cached prefix (identical for every user). */
export function requestPrefix() {
  return {
    model: ASSISTANT_MODEL,
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

export async function runChat(opts: RunOptions): Promise<void> {
  const { client, emit, signal, log } = opts;
  const entities: ToolHost['entities'] = new Map();
  const tools = buildTools({ ...opts.host, emit, entities });
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const maxIterations = opts.maxIterations ?? ASSISTANT_MAX_ITERATIONS;
  let answer = '';
  let last: BetaMessage | undefined;
  let iterations = 0;
  const started = Date.now();

  try {
    const runner = client.beta.messages.toolRunner(
      {
        ...requestPrefix(),
        tools,
        messages: toApiMessages(opts.turns, opts.context),
        max_iterations: maxIterations,
        stream: true,
      },
      { signal },
    );
    for await (const stream of runner) {
      stream.on('text', (delta) => {
        answer += delta;
        emit({ type: 'text', delta });
      });
      last = await stream.finalMessage();
      iterations++;
      usage.inputTokens += last.usage.input_tokens;
      usage.outputTokens += last.usage.output_tokens;
      usage.cacheReadInputTokens += last.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationInputTokens += last.usage.cache_creation_input_tokens ?? 0;
    }
    log('assistant run', { iterations, ms: Date.now() - started, ...usage });
    if (!last) throw new Error('no message');
    // stop_reason before content: a final refusal (after any fallback) ends with an error.
    if (last.stop_reason === 'refusal') {
      emit({ type: 'error', code: 'refusal', message: REFUSAL_MESSAGE });
      return;
    }
    let stopReason: string = last.stop_reason ?? 'end_turn';
    if (stopReason === 'tool_use') {
      // The runner stopped at the iteration cap with tools still requested.
      stopReason = 'max_iterations';
      const note = iterationNote(maxIterations);
      answer += note;
      emit({ type: 'text', delta: note });
    }
    const mentioned = [...entities.values()].filter((e) => answer.includes(e.label));
    if (mentioned.length) emit({ type: 'entities', items: mentioned });
    emit({ type: 'done', stopReason, usage });
  } catch (err) {
    const reason = opts.abortReason();
    if (reason === 'client') {
      log('assistant run cancelled by the client', { iterations });
      return;
    }
    if (reason === 'timeout' || err instanceof Anthropic.APIConnectionTimeoutError) {
      emit({ type: 'error', code: 'timeout', message: 'The assistant took too long. Try again.' });
      return;
    }
    if (
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError ||
      (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)
    ) {
      log('assistant busy', { status: err instanceof Anthropic.APIError ? err.status : undefined });
      emit({ type: 'error', code: 'busy', message: BUSY_MESSAGE });
      return;
    }
    log('assistant run failed', { error: err instanceof Error ? err.message : String(err) });
    emit({
      type: 'error',
      code: 'failed',
      message:
        err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError
          ? 'The assistant is not set up correctly. Ask an administrator.'
          : 'Something went wrong. Try again.',
    });
  }
}
