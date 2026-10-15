import {
  CHAT_CHIPS_MAX,
  CHAT_MAX_TURNS,
  MESSAGE_TEXT_MAX,
  PREVIEWS_PER_MESSAGE_MAX,
  type AppendMessage,
  type ChatEvent,
  type ThreadMessage,
  type ThreadOutcome,
} from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { HttpError } from '../http-error.ts';
import { DASHBOARD_CHAT_MAX_ITERATIONS } from './assistant-config.ts';
import {
  chatCacheKey,
  runChat,
  type AbortReason,
  type RunOptions,
  type RunOutcome,
} from './assistant-runner.ts';
import { isDefaultTitle, titleFromPrompt, wantsAutoTitle } from './auto-title.ts';
import { autoRenameDashboard, permittedWidgetTypes, readingOrder } from './dashboard-tools.ts';
import type { ChatMessage } from './provider.ts';
import { dashboardBlock, userContext, type UserContext } from './system-prompt.ts';
import { newTurnState } from './tool-kit.ts';

/**
 * F19 §2: one dashboard-chat turn. The stored thread is the source of truth: the user message is
 * appended first, the model transcript is rebuilt from the thread, and the assistant message
 * (text + note, chips, the turn's change set) is appended on every end before `thread_saved`.
 */

// ---- per-dashboard lock (in memory, D-124) ----

/** F27 (D-154): who holds a dashboard's lock. */
export interface ChatHolder {
  userId: string;
  name: string;
}

const locks = new WeakMap<MockContext, Map<string, ChatHolder>>();
const lockSet = (ctx: MockContext) => {
  let set = locks.get(ctx);
  if (!set) locks.set(ctx, (set = new Map()));
  return set;
};

export const isChatRunning = (ctx: MockContext, dashboardId: string) =>
  lockSet(ctx).has(dashboardId);

/** F27: the person whose turn is running on the dashboard, if any. */
export const chatHolder = (ctx: MockContext, dashboardId: string): ChatHolder | undefined =>
  lockSet(ctx).get(dashboardId);

/** 409 `chat_busy`; F27: names the person asking when known (`details.by`). */
export const chatBusy = (by?: ChatHolder) =>
  by
    ? new HttpError(409, 'chat_busy', `${by.name} is asking the assistant…`, { by })
    : new HttpError(409, 'chat_busy', 'Another reply is in progress on this dashboard');

/** Throws `chat_busy` (with the holder) while a turn runs on the dashboard. */
export function requireChatIdle(ctx: MockContext, dashboardId: string): void {
  const by = chatHolder(ctx, dashboardId);
  if (by) throw chatBusy(by);
}

/**
 * Takes the lock or throws 409 `chat_busy`; returns the release function. F27: take and release
 * push an `assistant` event to everyone who has the dashboard open.
 */
export function takeChatLock(
  ctx: MockContext,
  dashboardId: string,
  by: ChatHolder = { userId: '', name: 'Someone' },
): () => void {
  const set = lockSet(ctx);
  requireChatIdle(ctx, dashboardId);
  set.set(dashboardId, by);
  ctx.hub?.dashboardEvent({ type: 'assistant', dashboardId, running: true, by });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(dashboardId);
    ctx.hub?.dashboardEvent({ type: 'assistant', dashboardId, running: false, by: null });
  };
}

// ---- transcript ----

/** The change notes appended to an assistant turn in the transcript (§2). */
export function changeNote(m: ThreadMessage): string {
  const lines: string[] = [];
  if (m.change) {
    lines.push(`[Changes: ${m.change.summary}]`);
    if (m.change.undoneAt !== null) lines.push('[The user undid these changes]');
  }
  // D-135: previews made (no status: card actions must not change earlier turns' bytes).
  for (const p of m.previews ?? [])
    lines.push(
      `[Previewed widget (not on the dashboard): ${JSON.stringify({ ...p.widget, id: undefined })}]`,
    );
  return lines.length ? `\n\n${lines.join('\n')}` : '';
}

/**
 * Thread → API messages: the last ≤ 30 messages starting at a user message, text only. F24
 * (D-141): the `<context>` and `<dashboard>` blocks go before the text of the latest user turn
 * only, so earlier turns stay byte-stable from turn to turn.
 */
export function threadToMessages(
  thread: readonly ThreadMessage[],
  context: string,
  dashboard: string,
): ChatMessage[] {
  let recent = thread.slice(-CHAT_MAX_TURNS);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  recent = firstUser < 0 ? [] : recent.slice(firstUser);
  const lastUser = recent.findLastIndex((m) => m.role === 'user');
  return recent.map((m, k): ChatMessage => {
    if (m.role === 'assistant')
      return { role: 'assistant', content: `${m.text.trim() || '(no answer)'}${changeNote(m)}` };
    if (k !== lastUser) return { role: 'user', content: m.text };
    return {
      role: 'user',
      content: [
        { type: 'text', text: context },
        { type: 'text', text: dashboard },
        { type: 'text', text: m.text },
      ],
    };
  });
}

/**
 * The stored assistant text: the answer plus a note on how the turn ended. D-155: a client
 * abort is `(stopped)` after the user's Stop and `(interrupted)` when the client went away.
 */
export function storedText(
  outcome: Pick<RunOutcome, 'text' | 'status' | 'error'>,
  clientNote = '(stopped)',
): string {
  const note =
    outcome.status === 'client'
      ? clientNote
      : outcome.status === 'error'
        ? `(error: ${outcome.error?.message ?? 'failed'})`
        : '';
  const text = [outcome.text.trim(), note].filter(Boolean).join('\n\n');
  return text.slice(0, MESSAGE_TEXT_MAX);
}

/**
 * D-155: how a turn ended, as stored on its assistant message. A timeout or a provider cut is
 * `interrupted` (with its error code); a client abort is `stopped` after Stop, else `interrupted`.
 */
export function turnOutcome(
  outcome: Pick<RunOutcome, 'status' | 'error' | 'endReason'>,
  abortReason: AbortReason | undefined,
): { outcome: ThreadOutcome; errorCode?: string } {
  if (outcome.status === 'done') return { outcome: 'done' };
  if (outcome.status === 'client')
    return { outcome: abortReason === 'stop' ? 'stopped' : 'interrupted' };
  const errorCode = outcome.error?.code ?? 'failed';
  const cut = outcome.endReason === 'timeout' || outcome.endReason === 'provider-cut';
  return { outcome: cut ? 'interrupted' : 'error', errorCode };
}

// ---- one turn ----

export interface DashboardTurnOptions extends Pick<
  RunOptions,
  'provider' | 'signal' | 'abortReason' | 'log' | 'emit' | 'onUsage'
> {
  ctx: MockContext;
  host: Omit<RunOptions['host'], 'mode' | 'turn'>;
  dashboardId: string;
  text: string;
  context: UserContext;
  /**
   * D-155: re-run this failed turn (from `DashboardStore.retryTurn`): its user message is reused,
   * its reply is replaced, and its chips, previews and change set carry over into the new turn.
   */
  retry?: { user: ThreadMessage; failed: ThreadMessage };
}

const SETUP_FAILED = 'Something went wrong. Try again.';

/**
 * Runs one turn; the caller holds the lock and releases it afterwards. Never throws once the
 * user message is stored (D-155: a failure before the model runs is stored as an `error` reply);
 * resolves with how the run ended.
 */
export async function runDashboardTurn(opts: DashboardTurnOptions): Promise<RunOutcome> {
  const { ctx, dashboardId, emit } = opts;
  const { user, permissions } = opts.host;
  const store = ctx.dashboards;
  const userMessage =
    opts.retry?.user ??
    store.appendMessage(user.id, dashboardId, { role: 'user', text: opts.text });
  const turn = newTurnState();
  const failed = opts.retry?.failed;
  if (failed) {
    turn.chips = [...failed.chips];
    turn.previews = [...failed.previews];
    if (failed.change) {
      turn.changeId = failed.change.id;
      turn.labels = [failed.change.summary];
    }
  }
  let setup: { messages: ChatMessage[]; autoTitle: boolean; firstPrompt: string };
  try {
    const widgetTypes = permittedWidgetTypes(permissions);
    const d = store.get(user.id, dashboardId);
    const byId = new Map(d.widgets.map((w) => [w.id, w]));
    // A retry leaves the failed reply out: the transcript ends with its user message.
    const threadMessages = store
      .thread(user.id, dashboardId)
      .messages.filter((m) => m.id !== failed?.id);
    // Auto-title: only while the title is the default and no earlier turn renamed it.
    const autoTitle = wantsAutoTitle(d.title, threadMessages);
    const block = dashboardBlock(
      { ...d, widgets: readingOrder(d).map((id) => byId.get(id)!) },
      widgetTypes,
      autoTitle,
    );
    setup = {
      messages: threadToMessages(
        threadMessages,
        userContext({ ...opts.context, widgetTypes }),
        block,
      ),
      autoTitle,
      firstPrompt: threadMessages.find((m) => m.role === 'user')?.text ?? userMessage.text,
    };
  } catch (err) {
    opts.log('dashboard chat: turn setup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    const outcome: RunOutcome = {
      text: '',
      status: 'error',
      error: { code: 'failed', message: SETUP_FAILED },
      turn,
      endReason: 'error',
    };
    const saved = saveAssistant(opts, outcome, userMessage);
    if (saved) emit(saved);
    emit({ type: 'error', code: 'failed', message: SETUP_FAILED });
    return outcome;
  }
  const { messages, autoTitle, firstPrompt } = setup;

  return runChat({
    provider: opts.provider,
    host: { ...opts.host, mode: { kind: 'dashboard', dashboardId }, turn },
    context: opts.context,
    messages,
    emit,
    signal: opts.signal,
    abortReason: opts.abortReason,
    log: opts.log,
    maxIterations: DASHBOARD_CHAT_MAX_ITERATIONS,
    cacheKey: chatCacheKey(user.id, `d:${dashboardId}`),
    onUsage: opts.onUsage,
    onFinish: (outcome) => {
      if (autoTitle && outcome.status === 'done') autoTitleFallback(opts, outcome, firstPrompt);
      const saved = saveAssistant(opts, outcome, userMessage);
      // After a client abort nobody is listening (a no-op); after Stop the stream is still open.
      if (saved) emit(saved);
    },
  });
}

/**
 * F19 auto-title fallback: the turn ended well but the model did not rename a dashboard that
 * still has its default title, so it is renamed from the user's first message (same change set).
 */
function autoTitleFallback(opts: DashboardTurnOptions, outcome: RunOutcome, prompt: string) {
  const { ctx, dashboardId } = opts;
  try {
    const d = ctx.dashboards.get(opts.host.user.id, dashboardId);
    if (!isDefaultTitle(d.title)) return;
    autoRenameDashboard(
      {
        ...opts.host,
        mode: { kind: 'dashboard', dashboardId },
        turn: outcome.turn,
        emit: opts.emit,
        entities: new Map(),
      },
      titleFromPrompt(prompt),
    );
  } catch (err) {
    opts.log('dashboard chat: auto-title failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function saveAssistant(
  opts: DashboardTurnOptions,
  outcome: RunOutcome,
  userMessage: ThreadMessage,
): Extract<ChatEvent, { type: 'thread_saved' }> | null {
  const { ctx, dashboardId } = opts;
  const store = ctx.dashboards;
  const ownerId = opts.host.user.id;
  const ended = turnOutcome(outcome, opts.abortReason());
  const msg: AppendMessage = {
    role: 'assistant' as const,
    text: storedText(outcome, ended.outcome === 'interrupted' ? '(interrupted)' : '(stopped)'),
    chips: outcome.turn.chips.slice(0, CHAT_CHIPS_MAX),
    changeId: outcome.turn.changeId,
    previews: outcome.turn.previews.slice(0, PREVIEWS_PER_MESSAGE_MAX),
    ...ended,
  };
  const failed = opts.retry?.failed;
  const write = (m: AppendMessage) =>
    failed
      ? store.replaceMessage(ownerId, dashboardId, failed.id, m)
      : store.appendMessage(ownerId, dashboardId, m);
  try {
    let assistant: ThreadMessage;
    try {
      assistant = write(msg);
    } catch (err) {
      // The change set may have been pruned; keep the message without it.
      if (!(err instanceof HttpError) || err.status !== 422 || !msg.changeId) throw err;
      assistant = write({ ...msg, changeId: undefined });
    }
    return { type: 'thread_saved', messages: [userMessage, assistant] };
  } catch (err) {
    // e.g. the dashboard was deleted mid-turn.
    opts.log('dashboard chat: could not save the answer', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
