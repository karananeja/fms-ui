import type { ChatEvent, ChatTurn } from '@shared/contract/index.ts';
import { createHash } from 'node:crypto';
import { ASSISTANT_MAX_ITERATIONS } from './assistant-config.ts';
import type { ToolHost } from './assistant-tools.ts';
import {
  OUT_OF_CREDITS_MESSAGE,
  ProviderCutError,
  rejectedMessage,
  totalInput,
  type ChatMessage,
  type ChatProvider,
  type Usage,
} from './provider.ts';
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

/**
 * F23/F24: why a chat stream ended (logged once per stream). `provider-cut`: the provider stream
 * ended without a finish, or dropped after output had started.
 */
export type EndReason = 'done' | 'error' | 'client-abort' | 'timeout' | 'provider-cut';
export const END_REASONS: readonly EndReason[] = [
  'done',
  'error',
  'client-abort',
  'timeout',
  'provider-cut',
];

export type AbortReason = 'timeout' | 'client' | 'stop';

/** How a run ended (F19: the dashboard chat stores the answer before the final event). */
export interface RunOutcome {
  /** The streamed answer text (plus any iteration note). */
  text: string;
  /** `client`: the caller went away (nothing more is emitted). */
  status: 'done' | 'error' | 'client';
  error?: { code: Extract<ChatEvent, { type: 'error' }>['code']; message: string };
  stopReason?: string;
  turn: TurnState;
  /** F24: set on every outcome passed back by `runChat`. */
  endReason?: EndReason;
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
  /**
   * Why `signal` fired: the 60 s timeout, the client closing the connection, or (D-155) the
   * user's Stop on the dashboard chat (`POST …/chat/stop`), which ends like a client abort.
   */
  abortReason: () => AbortReason | undefined;
  log: (msg: string, data?: object) => void;
  maxIterations?: number;
  /**
   * Called once when the run ends, before the final `done` / `error` event (also on a client
   * abort, when no event follows). Awaited.
   */
  onFinish?: (outcome: RunOutcome) => void | Promise<void>;
  /** F24: stable per user + chat (see `chatCacheKey`); routes OpenAI / xAI requests to a cache. */
  cacheKey?: string;
  /** F24: called once per completed provider run with its token usage (dev stats). */
  onUsage?: (provider: ChatProvider['name'], usage: Usage) => void;
}

/**
 * F24 (D-141): the cache key of one chat: `fms-` + 16 hex chars of sha256(user id, chat id), so
 * no ids leave the server. `chat` is `global` or `d:<dashboardId>`.
 */
export const chatCacheKey = (userId: string, chat: string) =>
  `fms-${createHash('sha256').update(`${userId}\n${chat}`).digest('hex').slice(0, 16)}`;

/** F24: the one log line of a turn's cache use. */
export function cacheLog(usage: Usage) {
  const inputTokens = totalInput(usage);
  const cachedTokens = usage.cacheReadInputTokens;
  return {
    cachedTokens,
    inputTokens,
    hitRate: inputTokens ? Math.round((cachedTokens / inputTokens) * 1000) / 1000 : 0,
  };
}

export const REFUSAL_MESSAGE =
  "Sorry, I can't help with that. I can answer questions about your vehicles, drivers, requests and reports.";
export const BUSY_MESSAGE = 'Assistant is busy, try again in a moment.';
const iterationNote = (n: number) =>
  `\n\nI stopped after ${n} steps without finishing. Try a narrower question.`;

/**
 * Client turns → API messages. F24 (D-141): earlier turns are plain text (byte-stable across
 * turns); the per-request `<context>` block leads the latest user turn only.
 */
export function toApiMessages(turns: ChatTurn[], context: UserContext): ChatMessage[] {
  const first = turns.findIndex((t) => t.role === 'user');
  const recent = first < 0 ? [] : turns.slice(first);
  const last = recent.findLastIndex((t) => t.role === 'user');
  return recent.map((t, k) =>
    k === last
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

export async function runChat(opts: RunOptions): Promise<RunOutcome> {
  const { provider, signal, log } = opts;
  const entities: ToolHost['entities'] = new Map();
  const turn = opts.host.turn ?? newTurnState();
  const maxIterations = opts.maxIterations ?? ASSISTANT_MAX_ITERATIONS;
  let answer = '';
  /** Output (text or a tool event) has reached the client: a later drop is a provider cut. */
  let streamed = false;
  const emit = (event: ChatEvent) => {
    streamed = true;
    opts.emit(event);
  };
  const started = Date.now();
  let final: RunOutcome = { text: '', status: 'error', turn, endReason: 'error' };

  try {
    const result = await provider.run({
      host: { ...opts.host, turn, emit, entities },
      messages: opts.messages ?? toApiMessages(opts.turns ?? [], opts.context),
      maxIterations,
      signal,
      cacheKey: opts.cacheKey,
      onText: (delta) => {
        answer += delta;
        emit({ type: 'text', delta });
      },
    });
    const usage: Usage = result.usage;
    opts.onUsage?.(provider.name, usage);
    // F24: one line per turn with the cache use (cached / all input tokens).
    log('assistant turn', {
      provider: provider.name,
      model: provider.model,
      iterations: result.iterations,
      ms: Date.now() - started,
      ...cacheLog(usage),
      ...usage,
    });
    // stop_reason before content: a final refusal (after any fallback) ends with an error.
    if (result.stopReason === 'refusal') {
      await fail('refusal', REFUSAL_MESSAGE);
      return final;
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
    await finish({ text: answer, status: 'done', stopReason, turn, endReason: 'done' });
    emit({ type: 'done', stopReason, usage });
  } catch (err) {
    const reason = opts.abortReason();
    if (reason === 'client' || reason === 'stop') {
      log('assistant run cancelled by the client', { provider: provider.name });
      await finish({ text: answer, status: 'client', turn, endReason: 'client-abort' });
      return final;
    }
    const cls = provider.classify(err);
    if (reason === 'timeout' || cls.kind === 'timeout') {
      await fail('timeout', 'The assistant took too long. Try again.', 'timeout');
      return final;
    }
    // A stream without a finish, or a drop (no HTTP status) after output had started, is a cut.
    const cut =
      err instanceof ProviderCutError ||
      (streamed && cls.kind !== 'auth' && cls.kind !== 'credits' && cls.status === undefined);
    if (cls.kind === 'busy' || cut) {
      log('assistant busy', {
        provider: provider.name,
        status: cls.status,
        cut,
        error: err instanceof Error ? err.message : String(err),
      });
      await fail('busy', BUSY_MESSAGE, cut ? 'provider-cut' : 'error');
      return final;
    }
    log('assistant run failed', {
      provider: provider.name,
      status: cls.status,
      error: err instanceof Error ? err.message : String(err),
    });
    await fail(
      'failed',
      cls.kind === 'credits'
        ? OUT_OF_CREDITS_MESSAGE
        : cls.kind === 'auth'
          ? 'The assistant is not set up correctly. Ask an administrator.'
          : cls.kind === 'rejected'
            ? rejectedMessage(cls.status)
            : 'Something went wrong. Try again.',
    );
  }
  return final;

  async function finish(outcome: RunOutcome) {
    final = outcome;
    try {
      await opts.onFinish?.(outcome);
    } catch (err) {
      log('assistant onFinish failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  async function fail(
    code: NonNullable<RunOutcome['error']>['code'],
    message: string,
    endReason: EndReason = 'error',
  ) {
    await finish({ text: answer, status: 'error', error: { code, message }, turn, endReason });
    emit({ type: 'error', code, message });
  }
}
