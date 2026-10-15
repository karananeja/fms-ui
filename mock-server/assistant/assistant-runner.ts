import type { ChatEvent, ChatTurn } from '@shared/contract/index.ts';
import { ASSISTANT_MAX_ITERATIONS } from './assistant-config.ts';
import type { ToolHost } from './assistant-tools.ts';
import type { ChatMessage, ChatProvider, Usage } from './provider.ts';
import { newTurnState, type TurnState } from './tool-kit.ts';
import { userContext, type UserContext } from './system-prompt.ts';

export { requestPrefix } from './anthropic-provider.ts';

/**
 * F17 run of one question, provider-neutral since F21 (D-134): the provider runs the streamed
 * tool loop; this forwards text deltas (tools emit their own start/end, report and dashboard
 * events), adds the iteration note and entity refs, and maps errors to the chat error codes.
 * Never throws: every outcome ends with exactly one `done` or `error` event (none if the client
 * went away).
 */

/** How a run ended (F19: the dashboard chat stores the answer before the final event). */
export interface RunOutcome {
  /** The streamed answer text (plus any iteration note). */
  text: string;
  /** `client`: the caller went away (nothing more is emitted). */
  status: 'done' | 'error' | 'client';
  error?: { code: Extract<ChatEvent, { type: 'error' }>['code']; message: string };
  stopReason?: string;
  turn: TurnState;
}

export interface RunOptions {
  provider: ChatProvider;
  host: Omit<ToolHost, 'emit' | 'entities'>;
  context: UserContext;
  /** The client transcript (F17), or … */
  turns?: ChatTurn[];
  /** … prebuilt API messages (F19 dashboard chat, built from the stored thread). */
  messages?: ChatMessage[];
  emit: (event: ChatEvent) => void;
  signal: AbortSignal;
  /** Why `signal` fired: the 60 s timeout, or the client closing the connection. */
  abortReason: () => 'timeout' | 'client' | undefined;
  log: (msg: string, data?: object) => void;
  maxIterations?: number;
  /**
   * Called once when the run ends, before the final `done` / `error` event (also on a client
   * abort, when no event follows). Awaited.
   */
  onFinish?: (outcome: RunOutcome) => void | Promise<void>;
}

export const REFUSAL_MESSAGE =
  "Sorry, I can't help with that. I can answer questions about your vehicles, drivers, requests and reports.";
export const BUSY_MESSAGE = 'Assistant is busy, try again in a moment.';
const iterationNote = (n: number) =>
  `\n\nI stopped after ${n} steps without finishing. Try a narrower question.`;

/** Client turns → API messages; the per-user context is the first block of the first user turn. */
export function toApiMessages(turns: ChatTurn[], context: UserContext): ChatMessage[] {
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

export async function runChat(opts: RunOptions): Promise<void> {
  const { provider, emit, signal, log } = opts;
  const entities: ToolHost['entities'] = new Map();
  const turn = opts.host.turn ?? newTurnState();
  const maxIterations = opts.maxIterations ?? ASSISTANT_MAX_ITERATIONS;
  let answer = '';
  const started = Date.now();

  try {
    const result = await provider.run({
      host: { ...opts.host, turn, emit, entities },
      messages: opts.messages ?? toApiMessages(opts.turns ?? [], opts.context),
      maxIterations,
      signal,
      onText: (delta) => {
        answer += delta;
        emit({ type: 'text', delta });
      },
    });
    const usage: Usage = result.usage;
    log('assistant run', {
      provider: provider.name,
      model: provider.model,
      iterations: result.iterations,
      ms: Date.now() - started,
      ...usage,
    });
    // stop_reason before content: a final refusal (after any fallback) ends with an error.
    if (result.stopReason === 'refusal') {
      await fail('refusal', REFUSAL_MESSAGE);
      return;
    }
    let stopReason = result.stopReason;
    if (stopReason === 'tool_use') {
      // The loop stopped at the iteration cap with tools still requested.
      stopReason = 'max_iterations';
      const note = iterationNote(maxIterations);
      answer += note;
      emit({ type: 'text', delta: note });
    }
    const mentioned = [...entities.values()].filter((e) => answer.includes(e.label));
    if (mentioned.length) emit({ type: 'entities', items: mentioned });
    await finish({ text: answer, status: 'done', stopReason, turn });
    emit({ type: 'done', stopReason, usage });
  } catch (err) {
    const reason = opts.abortReason();
    if (reason === 'client') {
      log('assistant run cancelled by the client', { provider: provider.name });
      await finish({ text: answer, status: 'client', turn });
      return;
    }
    const cls = provider.classify(err);
    if (reason === 'timeout' || cls.kind === 'timeout') {
      await fail('timeout', 'The assistant took too long. Try again.');
      return;
    }
    if (cls.kind === 'busy') {
      log('assistant busy', { provider: provider.name, status: cls.status });
      await fail('busy', BUSY_MESSAGE);
      return;
    }
    log('assistant run failed', {
      provider: provider.name,
      status: cls.status,
      error: err instanceof Error ? err.message : String(err),
    });
    await fail(
      'failed',
      cls.kind === 'auth'
        ? 'The assistant is not set up correctly. Ask an administrator.'
        : 'Something went wrong. Try again.',
    );
  }

  async function finish(outcome: RunOutcome) {
    try {
      await opts.onFinish?.(outcome);
    } catch (err) {
      log('assistant onFinish failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  async function fail(code: NonNullable<RunOutcome['error']>['code'], message: string) {
    await finish({ text: answer, status: 'error', error: { code, message }, turn });
    emit({ type: 'error', code, message });
  }
}
