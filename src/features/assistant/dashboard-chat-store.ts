import {
  CHAT_ERROR_CODES,
  CHAT_MAX_CHARS,
  type ChatEvent,
  type DashboardLink,
} from '@shared/contract/assistant.ts';
import type {
  ChangeSet,
  Dashboard,
  DashboardSummary,
  DashboardThread,
  ThreadMessage,
  ToolChip,
  WidgetPreview,
  WidgetPreviewStatus,
} from '@shared/contract/dashboards.ts';
import { ApiError, apiFetch, type ApiRequest } from '@/shared/api/api-client';
import { ERROR_TEXT, type ChatError, type ToolCall } from './assistant-store.ts';
import { ChatHttpError, isInterruption, streamSse, type ChatErrorCode } from './chat-stream.ts';
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
  /** D-135: widget previews proposed in this turn (stored with their card state). */
  previews: readonly WidgetPreview[];
  /** F23: `interrupted` = the stream broke; partial text and saved changes stay, Retry offered. */
  status: 'streaming' | 'done' | 'stopped' | 'error' | 'interrupted';
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
  /** F27: a prompt refused with `chat_busy`, handed back to the composer. */
  restore: string | null;
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
  restore: null,
};

const errorCode = (code: string | undefined): ChatErrorCode =>
  (CHAT_ERROR_CODES as readonly string[]).includes(code ?? '')
    ? (code as ChatErrorCode)
    : 'failed';

/** D-155: a stored message; its turn's outcome gives the status (Retry after a reload). */
const fromThread = (m: ThreadMessage): DashboardChatMessage => {
  const outcome = m.role === 'assistant' ? (m.outcome ?? 'done') : 'done';
  const code = errorCode(m.errorCode);
  return {
    id: m.id,
    seq: m.seq,
    role: m.role,
    text: m.text,
    chips: m.chips,
    change: m.change,
    createdAt: m.createdAt,
    tools: [],
    dashboards: [],
    previews: m.previews ?? [],
    status: outcome,
    error: outcome === 'error' ? { code, message: ERROR_TEXT[code] } : null,
  };
};

const RETRYABLE: ReadonlySet<DashboardChatMessage['status']> = new Set([
  'error',
  'interrupted',
  'stopped',
]);

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
      this.set({ status: 'ready', error: null, messages: this.withInterrupted(thread) });
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

  /**
   * F23: the stored thread, with an interrupted turn kept visible: the stored reply of that turn
   * (its chips and Undo come from the server) is marked `interrupted`; if the server didn't
   * store the turn, the local pair (question + partial reply) stays at the end.
   */
  private withInterrupted(thread: DashboardThread): DashboardChatMessage[] {
    const messages = thread.messages.map(fromThread);
    const cut = this.interrupted;
    this.interrupted = null;
    if (!cut) return messages;
    const i = messages.findLastIndex((m) => m.role === 'assistant' && (m.seq ?? 0) > cut.baseSeq);
    if (i >= 0) {
      const m = messages[i]!;
      messages[i] = {
        ...m,
        status: 'interrupted',
        text: m.text || cut.local.find((x) => x.role === 'assistant')?.text || '',
      };
      return messages;
    }
    return [...messages, ...cut.local];
  }

  private interrupted: { baseSeq: number; local: DashboardChatMessage[] } | null = null;

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
    this.set({ messages: [...this.state.messages, user], notice: null, restore: null });
    void this.run(user.id, message);
  }

  /**
   * D-155: asks the server to stop the turn (`POST …/chat/stop`, stored as `stopped` and answered
   * once saved), then aborts the stream; the server still saves what the turn did.
   */
  stop(): void {
    const controller = this.controller;
    if (!controller || this.stopping === controller) return;
    this.stopping = controller;
    void this.api(`${this.base}/chat/stop`, { method: 'POST' })
      .catch(() => {})
      .finally(() => controller.abort());
  }

  private stopping: AbortController | null = null;

  /**
   * Re-runs the last turn. D-155: when its stored reply failed (also after a reload), the server
   * re-runs that turn in place (`retryOf`: no second user message); else the last user text is
   * sent again as a new turn.
   */
  retry(): void {
    if (this.state.streaming || this.disposed) return;
    const msgs = this.state.messages;
    const failed = msgs.at(-1);
    const user = msgs.at(-2);
    if (
      failed?.role === 'assistant' &&
      failed.seq !== null &&
      RETRYABLE.has(failed.status) &&
      user?.role === 'user' &&
      user.seq !== null
    ) {
      this.loadController?.abort();
      this.set({ messages: msgs.slice(0, -1), notice: null, restore: null });
      void this.run(user.id, user.text, failed.id);
      return;
    }
    const last = [...msgs].reverse().find((m) => m.role === 'user');
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

  /**
   * D-135: records a preview card's state (`PATCH …/previews/:id`); optimistic, reverted with a
   * notice on failure. Adding the widget itself is the page's dashboard save.
   */
  async setPreviewStatus(previewId: string, status: 'added' | 'discarded'): Promise<void> {
    const before = this.previewStatus(previewId);
    if (before === undefined || before === status) return;
    this.patchPreview(previewId, status);
    try {
      await this.api(`${this.base}/previews/${encodeURIComponent(previewId)}`, {
        method: 'PATCH',
        body: { status },
      });
    } catch (err) {
      if (this.disposed) return;
      this.patchPreview(previewId, before);
      this.set({
        notice:
          err instanceof ApiError && err.code === 'chat_busy'
            ? 'Another reply is in progress on this dashboard'
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  }

  private previewStatus(previewId: string): WidgetPreviewStatus | undefined {
    for (const m of this.state.messages)
      for (const p of m.previews) if (p.id === previewId) return p.status;
    return undefined;
  }

  private patchPreview(previewId: string, status: WidgetPreviewStatus): void {
    this.set({
      messages: this.state.messages.map((m) =>
        m.previews.some((p) => p.id === previewId)
          ? { ...m, previews: m.previews.map((p) => (p.id === previewId ? { ...p, status } : p)) }
          : m,
      ),
    });
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

  private async run(userId: string, message: string, retryOf?: string): Promise<void> {
    const answer: DashboardChatMessage = { ...this.blank('assistant'), status: 'streaming' };
    const id = answer.id;
    const controller = new AbortController();
    this.controller = controller;
    const baseSeq = Math.max(0, ...this.state.messages.map((m) => m.seq ?? 0));
    this.interrupted = null;
    this.set({ messages: [...this.state.messages, answer], streaming: true });
    let ended = false;
    let cut = false;
    let stopped = false;
    const onEvent = (e: ChatEvent) => {
      if (this.controller !== controller || ended) return;
      if (e.type === 'error' || e.type === 'done') ended = true;
      this.apply(userId, id, e);
    };
    try {
      const body = retryOf ? { message, retryOf } : { message };
      await this.stream(`${this.base}/chat`, body, onEvent, controller.signal);
      if (this.controller !== controller) return;
      // D-155: after Stop the server ends the stream (no `done`); that is not a cut.
      if (!ended) {
        if (this.stopping === controller) {
          stopped = true;
          this.finish(id, 'stopped', null);
        } else cut = true;
      }
    } catch (err) {
      if (this.controller !== controller) return;
      if (controller.signal.aborted) {
        stopped = true;
        this.finish(id, 'stopped', null);
      } else if (isInterruption(err)) {
        cut = true;
      } else if (
        retryOf &&
        err instanceof ChatHttpError &&
        err.status === 409 &&
        err.code !== 'chat_busy'
      ) {
        // D-155: 409 `not_retryable`: that turn is no longer the latest failed one (e.g. it did
        // finish on the server); the reload below shows the stored thread.
        this.set({ messages: this.state.messages.filter((m) => m.id !== id) });
      } else if (err instanceof ChatHttpError && err.code === 'chat_busy') {
        // F27 (D-154): someone else's turn is running: a notice, not an error bubble.
        this.set({
          // A retry's user message is stored: keep it (and reload the failed reply below).
          messages: this.state.messages.filter(
            (m) => m.id !== id && (retryOf !== undefined || m.id !== userId),
          ),
          notice: err.message,
          restore: retryOf ? null : message,
        });
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
        if (cut) {
          this.finish(id, 'interrupted', null);
          const target = this.renamed.get(id) ?? id;
          this.interrupted = {
            baseSeq,
            local: this.state.messages.filter(
              (m) => m.id === userId || m.id === target || (m.seq ?? 0) > baseSeq,
            ),
          };
        }
        this.controller = null;
        if (this.stopping === controller) this.stopping = null;
        this.set({ streaming: false });
        // A stop or a cut: the server saved what the turn did; pick it up (changes stay undoable).
        // D-155: so does a refused retry (the failed reply comes back from the thread).
        const reload = stopped || cut || controller.signal.aborted || (!!retryOf && !ended);
        if (reload && !this.disposed) void this.load();
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
      case 'widget_preview':
        return this.update(id, (m) => ({
          previews: [...m.previews.filter((p) => p.id !== e.preview.id), e.preview],
        }));
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
      return {
        ...view,
        tools: live.tools,
        dashboards: live.dashboards,
        previews: view.previews.length ? view.previews : live.previews,
        status: live.status,
      };
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
      previews: [],
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
