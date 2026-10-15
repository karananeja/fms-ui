import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import {
  CHAT_CHIPS_MAX,
  CHAT_MAX_TURNS,
  MESSAGE_TEXT_MAX,
  type ChatEvent,
  type ThreadMessage,
} from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { HttpError } from '../http-error.ts';
import { DASHBOARD_CHAT_MAX_ITERATIONS } from './assistant-config.ts';
import { runChat, type RunOptions, type RunOutcome } from './assistant-runner.ts';
import { permittedWidgetTypes, readingOrder } from './dashboard-tools.ts';
import { dashboardBlock, userContext, type UserContext } from './system-prompt.ts';
import { newTurnState } from './tool-kit.ts';

/**
 * F19 §2: one dashboard-chat turn. The stored thread is the source of truth: the user message is
 * appended first, the model transcript is rebuilt from the thread, and the assistant message
 * (text + note, chips, the turn's change set) is appended on every end before `thread_saved`.
 */

// ---- per-dashboard lock (in memory, D-124) ----

const locks = new WeakMap<MockContext, Set<string>>();
const lockSet = (ctx: MockContext) => {
  let set = locks.get(ctx);
  if (!set) locks.set(ctx, (set = new Set()));
  return set;
};

export const isChatRunning = (ctx: MockContext, dashboardId: string) =>
  lockSet(ctx).has(dashboardId);

export const chatBusy = () =>
  new HttpError(409, 'chat_busy', 'Another reply is in progress on this dashboard');

/** Takes the lock or throws 409 `chat_busy`; returns the release function. */
export function takeChatLock(ctx: MockContext, dashboardId: string): () => void {
  const set = lockSet(ctx);
  if (set.has(dashboardId)) throw chatBusy();
  set.add(dashboardId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(dashboardId);
  };
}

// ---- transcript ----

/** The change notes appended to an assistant turn in the transcript (§2). */
export function changeNote(m: ThreadMessage): string {
  if (!m.change) return '';
  const lines = [`[Changes: ${m.change.summary}]`];
  if (m.change.undoneAt !== null) lines.push('[The user undid these changes]');
  return `\n\n${lines.join('\n')}`;
}

/**
 * Thread → API messages: the last ≤ 30 messages starting at a user message, text only. The
 * `<context>` block leads the first user turn; the `<dashboard>` block goes before the text of
 * the latest user turn only, so earlier turns stay byte-stable.
 */
export function threadToMessages(
  thread: readonly ThreadMessage[],
  context: string,
  dashboard: string,
): BetaMessageParam[] {
  let recent = thread.slice(-CHAT_MAX_TURNS);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  recent = firstUser < 0 ? [] : recent.slice(firstUser);
  const lastUser = recent.findLastIndex((m) => m.role === 'user');
  return recent.map((m, k): BetaMessageParam => {
    if (m.role === 'assistant')
      return { role: 'assistant', content: `${m.text.trim() || '(no answer)'}${changeNote(m)}` };
    const blocks: { type: 'text'; text: string }[] = [];
    if (k === 0) blocks.push({ type: 'text', text: context });
    if (k === lastUser) blocks.push({ type: 'text', text: dashboard });
    if (!blocks.length) return { role: 'user', content: m.text };
    blocks.push({ type: 'text', text: m.text });
    return { role: 'user', content: blocks };
  });
}

/** The stored assistant text: the answer plus a note on how the turn ended. */
export function storedText(outcome: Pick<RunOutcome, 'text' | 'status' | 'error'>): string {
  const note =
    outcome.status === 'client'
      ? '(stopped)'
      : outcome.status === 'error'
        ? `(error: ${outcome.error?.message ?? 'failed'})`
        : '';
  const text = [outcome.text.trim(), note].filter(Boolean).join('\n\n');
  return text.slice(0, MESSAGE_TEXT_MAX);
}

// ---- one turn ----

export interface DashboardTurnOptions extends Pick<
  RunOptions,
  'client' | 'signal' | 'abortReason' | 'log' | 'emit'
> {
  ctx: MockContext;
  host: Omit<RunOptions['host'], 'mode' | 'turn'>;
  dashboardId: string;
  text: string;
  context: UserContext;
  client: Anthropic;
}

/** Runs one turn; the caller holds the lock and releases it afterwards. Never throws. */
export async function runDashboardTurn(opts: DashboardTurnOptions): Promise<void> {
  const { ctx, dashboardId, emit } = opts;
  const { user, permissions } = opts.host;
  const store = ctx.dashboards;
  const userMessage = store.appendMessage(user.id, dashboardId, { role: 'user', text: opts.text });
  const widgetTypes = permittedWidgetTypes(permissions);
  const d = store.get(user.id, dashboardId);
  const byId = new Map(d.widgets.map((w) => [w.id, w]));
  const block = dashboardBlock(
    { ...d, widgets: readingOrder(d).map((id) => byId.get(id)!) },
    widgetTypes,
  );
  const messages = threadToMessages(
    store.thread(user.id, dashboardId).messages,
    userContext({ ...opts.context, widgetTypes }),
    block,
  );
  const turn = newTurnState();

  await runChat({
    client: opts.client,
    host: { ...opts.host, mode: { kind: 'dashboard', dashboardId }, turn },
    context: opts.context,
    messages,
    emit,
    signal: opts.signal,
    abortReason: opts.abortReason,
    log: opts.log,
    maxIterations: DASHBOARD_CHAT_MAX_ITERATIONS,
    onFinish: (outcome) => {
      const saved = saveAssistant(opts, outcome, userMessage);
      if (saved && outcome.status !== 'client') emit(saved);
    },
  });
}

function saveAssistant(
  opts: DashboardTurnOptions,
  outcome: RunOutcome,
  userMessage: ThreadMessage,
): Extract<ChatEvent, { type: 'thread_saved' }> | null {
  const { ctx, dashboardId } = opts;
  const store = ctx.dashboards;
  const ownerId = opts.host.user.id;
  const msg = {
    role: 'assistant' as const,
    text: storedText(outcome),
    chips: outcome.turn.chips.slice(0, CHAT_CHIPS_MAX),
    changeId: outcome.turn.changeId,
  };
  try {
    let assistant: ThreadMessage;
    try {
      assistant = store.appendMessage(ownerId, dashboardId, msg);
    } catch (err) {
      // The change set may have been pruned; keep the message without it.
      if (!(err instanceof HttpError) || err.status !== 422 || !msg.changeId) throw err;
      assistant = store.appendMessage(ownerId, dashboardId, { ...msg, changeId: undefined });
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
