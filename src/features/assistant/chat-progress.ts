import { isDashboardMutatingTool } from '@shared/contract/assistant.ts';
import { ERROR_TEXT, type ChatError, type ToolCall } from './assistant-store.ts';

/** F23: what the running turn is doing now ("Thinking…", a tool step, "Writing the answer…"). */
export function progressLabel(m: { text: string; tools?: readonly ToolCall[] }): string {
  const running = (m.tools ?? []).findLast((t) => t.ok === null);
  if (running) return running.label.endsWith('…') ? running.label : `${running.label}…`;
  return m.text ? 'Writing the answer…' : 'Thinking…';
}

/** `7s`, `1m 05s`. */
export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

export interface TurnActivity {
  /** A reply is streaming. */
  streaming: boolean;
  /** …and it is changing the dashboard (a mutating tool runs or already changed it). */
  changing: boolean;
}

/** F23: what the dashboard page needs from its chat (build state + whether the thread is empty). */
export interface DockState extends TurnActivity {
  /** The thread has loaded. */
  ready: boolean;
  messages: number;
  /** The last turn failed or broke off (the empty canvas shows it with Retry). */
  failure: TurnFailure | null;
}

export interface TurnFailure {
  message: string;
  /** Retry is offered (not for a refusal). */
  retryable: boolean;
  /** A provider / setup problem: the canvas links to AI settings. */
  setup: boolean;
}

export const IDLE_DOCK: DockState = {
  streaming: false,
  changing: false,
  ready: false,
  messages: 0,
  failure: null,
};

const INTERRUPTED_TEXT = 'The last answer was cut off before it finished.';

/** What the empty canvas shows for the thread's last reply, or `null` when it ended normally. */
export function turnFailure(
  last: { role: string; status: string; error: ChatError | null } | undefined,
): TurnFailure | null {
  if (!last || last.role !== 'assistant') return null;
  if (last.status === 'interrupted')
    return { message: INTERRUPTED_TEXT, retryable: true, setup: false };
  if (last.status !== 'error' || !last.error) return null;
  const { code, message } = last.error;
  // `failed` covers many causes; the server's message names this one (as in the chat).
  const text = code === 'failed' && message ? message : ERROR_TEXT[code];
  return {
    message: text,
    retryable: code !== 'refusal',
    // Credits, a rejected model, a bad key: the server's copy points at settings / an admin.
    setup: code === 'not_configured' || /settings|administrator/i.test(text),
  };
}

/** F23: whether a dashboard chat's running turn is changing the dashboard. */
export function turnActivity(
  streaming: boolean,
  last: { status: string; tools: readonly ToolCall[]; change: unknown } | undefined,
): TurnActivity {
  if (!streaming || !last || last.status !== 'streaming') return { streaming, changing: false };
  const changing =
    !!last.change || last.tools.some((t) => t.ok !== false && isDashboardMutatingTool(t.name));
  return { streaming, changing };
}
