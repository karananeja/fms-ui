import { isDashboardMutatingTool } from '@shared/contract/assistant.ts';
import type { ToolCall } from './assistant-store.ts';

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
}

export const IDLE_DOCK: DockState = { streaming: false, changing: false, ready: false, messages: 0 };

/** F23: whether a dashboard chat's running turn is changing the dashboard. */
export function turnActivity(
  streaming: boolean,
  last:
    | { status: string; tools: readonly ToolCall[]; change: unknown }
    | undefined,
): TurnActivity {
  if (!streaming || !last || last.status !== 'streaming') return { streaming, changing: false };
  const changing =
    !!last.change || last.tools.some((t) => t.ok !== false && isDashboardMutatingTool(t.name));
  return { streaming, changing };
}
