import { CHAT_MAX_CHARS, type ChatEvent, type DashboardLink } from '@shared/contract/assistant.ts';
import type {
  ChangeSet,
  Dashboard,
  DashboardSummary,
  DashboardThread,
  ThreadMessage,
  ToolChip,
} from '@shared/contract/dashboards.ts';
import { ApiError, apiFetch, type ApiRequest } from '@/shared/api/api-client';
import type { ChatError, ToolCall } from './assistant-store.ts';
import { ChatHttpError, streamSse } from './chat-stream.ts';
import { dashboardEvents } from './dashboard-events.ts';

export type DashboardChangedEvent = Extract<ChatEvent, { type: 'dashboard_changed' }>;

/** A thread message as the dashboard chat shows it (stored fields + live streaming state). */
export interface DashboardChatMessage {
  id: string;
  /** `null` until the server stored it (`thread_saved`). */
  seq: number | null;
  role: 'user' | 'assistant';
  text: string;
  /** Stored chips (one per tool call of the turn). */
  chips: readonly ToolChip[];
  /** The turn's change set (assistant messages that changed the dashboard). */
  change: ChangeSet | null;
  createdAt: number;
  /** Live tool calls while the turn streams (empty for stored messages). */
  tools: readonly ToolCall[];
  /** Dashboards created in this turn (`create_dashboard`). */
  dashboards: readonly DashboardLink[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  error: ChatError | null;
}

export interface DashboardChatState {
  status: 'loading' | 'ready' | 'error';
  messages: readonly DashboardChatMessage[];
  /** True while a reply streams (Stop shown, Undo hidden). */
  streaming: boolean;
  notConfigured: boolean;
  /** Load failure text (`status: 'error'`). */
  error: string | null;
  /** A transient notice, e.g. "This change can no longer be undone". */
  notice: string | null;
  /** The change id whose Undo is in flight. */
  undoing: string | null;
}

export interface DashboardChatCallbacks {
  /** The dashboard changed (an AI tool call or an Undo): replace the page's copy and version. */
  onDashboardChanged?(dashboard: Dashboard, event?: DashboardChangedEvent): void;
  /** `create_dashboard` made a separate dashboard. */
  onDashboardCreated?(summary: DashboardSummary, url: string): void;
}

export type DashboardChatStream = (
  url: string,
  body: unknown,
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

export interface DashboardChatDeps {
  api?: <T>(path: string, req?: ApiRequest) => Promise<T>;
  stream?: DashboardChatStream;
  /** Called on a 401 from the chat stream (the REST client handles its own 401s). */
  onUnauthorized?: () => void;
  now?: () => number;
}

export const UNDO_GONE_TEXT = 'This change can no longer be undone';

const initial: DashboardChatState = {
  status: 'loading',
  messages: [],
  streaming: false,
  notConfigured: false,
  error: null,
  notice: null,
  undoing: null,
};

const fromThread = (m: ThreadMessage): DashboardChatMessage => ({
  id: m.id,
  seq: m.seq,
  role: m.role,
  text: m.text,
  chips: m.chips,
  change: m.change,
  createdAt: m.createdAt,
  tools: [],
  dashboards: [],
  status: 'done',
  error: null,
});

/**
 * F19 §7: the chat of one dashboard (main thread, F17-R6 style). The server thread is the
 * source of truth: `load()` reads it, `send()` streams one turn and `thread_saved` replaces
 * the optimistic pair with the stored messages. One instance per dashboard id; `dispose()`
 * on unmount or user change.
 */
export class DashboardChatStore {
  private state: DashboardChatState = initial;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private loadController: AbortController | null = null;
  private seq = 0;
  private disposed = false;
  private readonly api: NonNullable<DashboardChatDeps['api']>;
  private readonly stream: DashboardChatStream;
  private readonly now: () => number;

  constructor(
    readonly dashboardId: string,
    private callbacks: DashboardChatCallbacks = {},
    private readonly deps: DashboardChatDeps = {},
  ) {
    this.api = deps.api ?? apiFetch;
    this.stream = deps.stream ?? streamSse;
    this.now = deps.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DashboardChatState => this.state;

  /** The latest callbacks (the hook updates them every render). */
  setCallbacks(callbacks: DashboardChatCallbacks): void {
    this.callbacks = callbacks;
  }

  private get base() {
    return `/api/dashboards/${encodeURIComponent(this.dashboardId)}`;
  }

  /** `GET …/thread`; ignored while a turn streams (its `thread_saved` is newer). */
  async load(): Promise<void> {
    if (this.state.streaming) return;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    if (!this.state.messages.length) this.set({ status: 'loading', error: null });
    try {
      const thread = await this.api<DashboardThread>(`${this.base}/thread`, {
        signal: controller.signal,
      });
      if (this.loadController !== controller || this.disposed || this.state.streaming) return;
      this.set({ status: 'ready', error: null, messages: thread.messages.map(fromThread) });
    } catch (err) {
      if (this.loadController !== controller || this.disposed || controller.signal.aborted) return;
      this.set({
        status: this.state.messages.length ? 'ready' : 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (this.loadController === controller) this.loadController = null;
    }
  }

  /** Sends `text` as a new turn; ignored while a reply streams or when empty. */
  send(text: string): void {
    const message = text.trim().slice(0, CHAT_MAX_CHARS);
    if (!message || this.state.streaming || this.disposed) return;
    this.loadController?.abort();
    const user: DashboardChatMessage = {
      ...this.blank('user'),
      text: message,
      status: 'done',
    };
    this.set({ messages: [...this.state.messages, user], notice: null });
    void this.run(user.id, message);
  }

  /** Aborts the stream; the server still saves what the turn did. */
  stop(): void {
    this.controller?.abort();
  }

  /** Sends the last user text again as a new turn. */
  retry(): void {
    if (this.state.streaming) return;
    const last = [...this.state.messages].reverse().find((m) => m.role === 'user');
    if (last) this.send(last.text);
  }

  /** REST undo of a turn's change set (`version` defaults to the change's `afterVersion`). */
  async undo(changeId: string, version?: number): Promise<void> {
    if (this.state.streaming || this.state.undoing) return;
    const change = this.state.messages.find((m) => m.change?.id === changeId)?.change;
    const v = version ?? change?.afterVersion;
    if (v === undefined) return;
    this.set({ undoing: changeId, notice: null });
    try {
      const dashboard = await this.api<Dashboard>(
        `${this.base}/changes/${encodeURIComponent(changeId)}/undo`,
        { method: 'POST', body: { version: v } },
      );
      if (this.disposed) return;
      const undoneAt = this.now();
      this.set({
        messages: this.state.messages.map((m) =>
          m.change
            ? {
                ...m,
                change:
                  m.change.id === changeId
                    ? { ...m.change, undoneAt, undoable: false }
                    : { ...m.change, undoable: false },
              }
            : m,
        ),
      });
      this.callbacks.onDashboardChanged?.(dashboard);
      dashboardEvents.emit({ kind: 'changed', dashboardId: this.dashboardId });
    } catch (err) {
      if (this.disposed) return;
      const conflict = err instanceof ApiError && err.status === 409;
      this.set({
        notice: conflict
          ? err.code === 'chat_busy'
            ? 'Another reply is in progress on this dashboard'
            : UNDO_GONE_TEXT
          : err instanceof Error
            ? err.message
            : String(err),
      });
      if (conflict) void this.load();
    } finally {
      if (!this.disposed) this.set({ undoing: null });
    }
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.loadController?.abort();
    this.listeners.clear();
  }

  private async run(userId: string, message: string): Promise<void> {
    const answer: DashboardChatMessage = { ...this.blank('assistant'), status: 'streaming' };
    const id = answer.id;
    const controller = new AbortController();
    this.controller = controller;
    this.set({ messages: [...this.state.messages, answer], streaming: true });
    let ended = false;
    const onEvent = (e: ChatEvent) => {
      if (this.controller !== controller || ended) return;
      if (e.type === 'error' || e.type === 'done') ended = true;
      this.apply(userId, id, e);
    };
    try {
      await this.stream(`${this.base}/chat`, { message }, onEvent, controller.signal);
      if (this.controller !== controller) return;
      if (!ended)
        this.finish(id, 'error', { code: 'failed', message: 'The answer was cut off. Try again.' });
    } catch (err) {
      if (this.controller !== controller) return;
      if (controller.signal.aborted) {
        this.finish(id, 'stopped', null);
      } else {
        const http = err instanceof ChatHttpError ? err : null;
        if (http?.status === 401) this.deps.onUnauthorized?.();
        this.finish(id, 'error', {
          code: http?.code ?? 'failed',
          message: http?.message ?? String(err),
        });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.set({ streaming: false });
        // A stop: the server saved the turn after the stream closed; pick it up.
        if (controller.signal.aborted && !this.disposed) void this.load();
      }
    }
  }

  private apply(userId: string, id: string, e: ChatEvent): void {
    switch (e.type) {
      case 'text':
        return this.update(id, (m) => ({ text: m.text + e.delta }));
      case 'tool_start':
        return this.update(id, (m) => ({
          tools: [...m.tools, { id: e.id, name: e.name, label: e.label, ok: null }],
        }));
      case 'tool_end':
        return this.update(id, (m) => ({
          tools: m.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, summary: e.summary } : t)),
        }));
      case 'dashboard_changed':
        this.update(id, (m) => ({
          // The running mutating tool's chip takes the past-tense label ("Updated widget: …").
          tools: relabelRunning(m.tools, e.label),
          change: {
            id: e.changeId,
            summary: e.summary,
            beforeVersion: m.change?.id === e.changeId ? m.change.beforeVersion : e.version - 1,
            afterVersion: e.version,
            undoneAt: null,
            undoable: false,
          },
        }));
        this.callbacks.onDashboardChanged?.(e.dashboard, e);
        dashboardEvents.emit({ kind: 'changed', dashboardId: e.dashboardId });
        return;
      case 'dashboard_created':
        this.update(id, (m) => ({
          dashboards: [...m.dashboards, { summary: e.dashboard, url: e.url }],
        }));
        this.callbacks.onDashboardCreated?.(e.dashboard, e.url);
        dashboardEvents.emit({ kind: 'created', dashboardId: e.dashboard.id });
        return;
      case 'thread_saved':
        return this.reconcile(userId, id, e.messages);
      case 'error':
        return this.finish(id, 'error', { code: e.code, message: e.message });
      case 'done':
        return this.finish(id, 'done', null);
      default:
        return;
    }
  }

  /** Replaces the optimistic pair with the stored messages; older chips lose Undo. */
  private reconcile(userId: string, id: string, stored: ThreadMessage[]): void {
    const live = this.state.messages.find((m) => m.id === id);
    const changed = stored.some((m) => m.change);
    const saved = stored.map((m) => {
      const view = fromThread(m);
      if (m.role !== 'assistant' || !live) return view;
      // Keep the live view (tools, created links, status) until the stream ends.
      return { ...view, tools: live.tools, dashboards: live.dashboards, status: live.status };
    });
    const savedAssistant = saved.find((m) => m.role === 'assistant');
    const rest = this.state.messages
      .filter((m) => m.id !== userId && m.id !== id)
      .map((m) => (changed && m.change ? { ...m, change: { ...m.change, undoable: false } } : m));
    this.set({ messages: [...rest, ...saved] });
    // Later events (done / error) address the stored assistant message.
    if (savedAssistant && savedAssistant.id !== id) this.renamed.set(id, savedAssistant.id);
  }

  private readonly renamed = new Map<string, string>();

  private finish(
    id: string,
    status: DashboardChatMessage['status'],
    error: ChatError | null,
  ): void {
    this.update(id, (m) => ({
      status,
      error,
      // Once the turn is stored, its saved chips (final labels + Undo) replace the live ones.
      tools:
        status === 'done' && m.chips.length > 0
          ? []
          : m.tools.map((t) => (t.ok === null ? { ...t, ok: false } : t)),
    }));
    if (error?.code === 'not_configured') this.set({ notConfigured: true });
  }

  private update(
    id: string,
    patch: (m: DashboardChatMessage) => Partial<DashboardChatMessage>,
  ): void {
    const target = this.renamed.get(id) ?? id;
    this.set({
      messages: this.state.messages.map((m) => (m.id === target ? { ...m, ...patch(m) } : m)),
    });
  }

  private blank(role: 'user' | 'assistant'): DashboardChatMessage {
    return {
      id: `local-${++this.seq}`,
      seq: null,
      role,
      text: '',
      chips: [],
      change: null,
      createdAt: this.now(),
      tools: [],
      dashboards: [],
      status: 'done',
      error: null,
    };
  }

  private set(patch: Partial<DashboardChatState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

function relabelRunning<T extends { ok: boolean | null; label: string }>(
  tools: readonly T[],
  label: string,
): readonly T[] {
  const i = tools.findLastIndex((t) => t.ok === null);
  return i < 0 ? tools : tools.map((t, j) => (j === i ? { ...t, label } : t));
}
