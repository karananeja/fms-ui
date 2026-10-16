import {
  CHAT_ERROR_CODES,
  CHAT_MAX_CHARS,
  type ChatEvent,
  type ChatRequest,
  type ChatThreadMessage,
  type DashboardLink,
  type EntityRef,
  type ReportDescriptor,
} from '@shared/contract/assistant.ts';
import {
  CHAT_THREAD_RECENT_MS,
  type ChatThreadDetail,
  type ChatThreadList,
  type ChatThreadSummary,
} from '@shared/contract/chat-threads.ts';
import type { ActionCard } from '@shared/contract/actions.ts';
import type { ToolChip, WidgetPreview } from '@shared/contract/dashboards.ts';
import { sessionStore, type SessionState } from '@/features/auth/session/session-store';
import { ApiError, apiFetch, type ApiRequest } from '@/shared/api/api-client';
import { dashboardEvents } from './dashboard-events.ts';
import {
  ChatHttpError,
  httpChatTransport,
  isInterruption,
  type ChatErrorCode,
  type ChatTransport,
} from './chat-stream.ts';

export interface ToolCall {
  id: string;
  name: string;
  label: string;
  /** `null` while running. */
  ok: boolean | null;
  summary?: string;
}

export interface ChatError {
  code: ChatErrorCode;
  message: string;
}

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  /** F28: `null` until the server stored it (`thread_saved`). */
  seq?: number | null;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  tools: readonly ToolCall[];
  reports: readonly ReportDescriptor[];
  entities: readonly EntityRef[];
  /** F19: dashboards created in this answer (shown as "Open dashboard" cards). */
  dashboards?: readonly DashboardLink[];
  /** D-135: widget previews (their card state is local). */
  previews?: readonly WidgetPreview[];
  /** F29: actions proposed in this reply. */
  actions?: readonly ActionCard[];
  /** F28: the stored tool chips of a saved reply (live `tools` are empty then). */
  chips?: readonly ToolChip[];
  /** F28: `null` until the server stored it. */
  seq?: number | null;
  /** F23: `interrupted` = the stream ended without `done`/`error` (partial text kept, Retry). */
  status: 'streaming' | 'done' | 'stopped' | 'error' | 'interrupted';
  error: ChatError | null;
}

export type Message = UserMessage | AssistantMessage;

export interface ChatHistory {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly ChatThreadSummary[];
  nextCursor: string | null;
  q: string;
  error: string | null;
}

export interface AssistantState {
  messages: readonly Message[];
  /** True while an answer streams (the composer shows Stop). */
  streaming: boolean;
  /** F17-R5: the server has no model configured; the panel shows a set-up notice instead. */
  notConfigured: boolean;
  /** F28: the open saved conversation (`null` = a new chat, no server row yet). */
  threadId: string | null;
  title: string | null;
  /** F28: a saved conversation is being opened. */
  loading: boolean;
  /** F28: a transient notice (e.g. `chat_busy`, a failed load). */
  notice: string | null;
  /** F28: a prompt refused with `chat_busy`, handed back to the composer. */
  restore: string | null;
  history: ChatHistory;
}

export interface AssistantSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Pick<SessionState, 'status' | 'me'>;
  expire?(): void;
}

/**
 * Per-tab memory of the open thread (F28, D-164); a fake in tests. `get` is `undefined` when this
 * tab has no memory for the user, `null` when the user's last choice here was New chat.
 */
export interface ThreadMemory {
  get(userId: string): string | null | undefined;
  set(userId: string, threadId: string | null): void;
}

export interface AssistantStoreDeps {
  transport?: ChatTransport;
  session?: AssistantSession;
  api?: <T>(path: string, req?: ApiRequest) => Promise<T>;
  memory?: ThreadMemory;
  now?: () => number;
}

/** User-facing copy per error code (F17-R2, R5). */
export const ERROR_TEXT: Record<ChatErrorCode, string> = {
  not_configured: "Assistant isn't set up yet",
  busy: 'Assistant is busy, try again',
  refusal: "I can't help with that.",
  timeout: 'That took too long. Try again or ask a narrower question.',
  failed: 'Something went wrong. Try again.',
  chat_busy: 'Another reply is in progress on this dashboard',
};

/** Shown when the panel is empty. */
export const SUGGESTED_PROMPTS = [
  'Which vehicles have no GPS right now?',
  'Summarise fleet utilisation for the last 7 days',
  'Export no-GPS vehicles as CSV',
  'Who are the top drivers this week?',
] as const;

const emptyHistory: ChatHistory = {
  status: 'idle',
  items: [],
  nextCursor: null,
  q: '',
  error: null,
};

const initial: AssistantState = {
  messages: [],
  streaming: false,
  notConfigured: false,
  threadId: null,
  title: null,
  loading: false,
  notice: null,
  restore: null,
  history: emptyHistory,
};

/** `{ [userId]: threadId | null }` in `sessionStorage` (per browser tab). */
export const THREAD_MEMORY_KEY = 'fms.ask-fms.thread';

const readMemory = (): Record<string, string | null> => {
  const raw = sessionStorage.getItem(THREAD_MEMORY_KEY);
  const v: unknown = raw ? JSON.parse(raw) : null;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | null>) : {};
};

/** Every storage access may throw (private mode, blocked storage): then nothing is remembered. */
export const sessionThreadMemory: ThreadMemory = {
  get(userId) {
    try {
      const v = readMemory()[userId];
      return typeof v === 'string' || v === null ? v : undefined;
    } catch {
      return undefined;
    }
  },
  set(userId, threadId) {
    try {
      sessionStorage.setItem(
        THREAD_MEMORY_KEY,
        JSON.stringify({ ...readMemory(), [userId]: threadId }),
      );
    } catch {
      // Storage unavailable: the panel falls back to the latest thread.
    }
  },
};

const errorCode = (code: string | null | undefined): ChatErrorCode =>
  (CHAT_ERROR_CODES as readonly string[]).includes(code ?? '') ? (code as ChatErrorCode) : 'failed';

const STORED_NOTE = /(?:^|\n\n)\((?:error: ([\s\S]*)|stopped|interrupted)\)$/;

/** F28: a stored message as the panel shows it; the stored outcome gives the status (Retry). */
export function fromStored(m: ChatThreadMessage): Message {
  if (m.role === 'user') return { id: m.id, role: 'user', text: m.text, seq: m.seq };
  const outcome = m.outcome;
  const code = errorCode(m.errorCode);
  // The server appends how the turn ended; the status row shows that, so the note is cut.
  const note = outcome === 'done' ? null : STORED_NOTE.exec(m.text);
  return {
    id: m.id,
    role: 'assistant',
    seq: m.seq,
    text: note ? m.text.slice(0, note.index).trimEnd() : m.text,
    tools: [],
    chips: m.extras.chips ?? [],
    reports: m.extras.reports ?? [],
    entities: m.extras.entities ?? [],
    dashboards: m.extras.dashboards ?? [],
    previews: m.extras.previews ?? [],
    actions: m.extras.actions ?? [],
    status: outcome,
    error: outcome === 'error' ? { code, message: note?.[1] ?? ERROR_TEXT[code] } : null,
  };
}

const RETRYABLE: ReadonlySet<AssistantMessage['status']> = new Set([
  'error',
  'interrupted',
  'stopped',
]);

const isStored = (m: Message | undefined) => m?.seq !== undefined && m.seq !== null;

/**
 * F17-R6 / F28 (D-163, D-164): the global Ask FMS conversation (main thread, low volume). The
 * server keeps each conversation: `send` posts only the new message (`{ threadId?, message }`),
 * `thread_saved` swaps the optimistic messages for the stored ones and names the thread. The
 * history (list, rename, delete) comes from `/api/chat/threads`. A different user (or sign-out)
 * drops everything from memory.
 */
export class AssistantStore {
  private state: AssistantState = initial;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private stopping: AbortController | null = null;
  private loadController: AbortController | null = null;
  private userId: string | null = null;
  private opened = false;
  private seq = 0;
  /** Local message id → stored id (events after `thread_saved` address the stored one). */
  private readonly renamed = new Map<string, string>();
  private readonly transport: ChatTransport;
  private readonly session: AssistantSession | undefined;
  private readonly api: NonNullable<AssistantStoreDeps['api']>;
  private readonly memory: ThreadMemory;
  private readonly now: () => number;

  constructor(deps: AssistantStoreDeps = {}) {
    this.transport = deps.transport ?? httpChatTransport;
    this.session = deps.session;
    this.api = deps.api ?? apiFetch;
    this.memory = deps.memory ?? sessionThreadMemory;
    this.now = deps.now ?? Date.now;
    if (this.session) {
      this.userId = this.currentUser();
      this.session.subscribe(() => {
        const id = this.currentUser();
        if (id !== this.userId) {
          this.userId = id;
          this.opened = false;
          this.reset();
        }
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AssistantState => this.state;

  /**
   * F28 (D-164): the panel opened. The first time per user it shows the thread used last in this
   * tab, else the most recent thread when it was updated in the last 12 h, else a new chat.
   */
  async open(): Promise<void> {
    if (this.opened || !this.userId) return;
    this.opened = true;
    if (this.state.threadId || this.state.messages.length) return;
    const remembered = this.memory.get(this.userId);
    // New chat was the last choice in this tab: it stays a new chat.
    if (remembered === null) return;
    if (remembered && (await this.load(remembered, { quiet: true }))) return;
    try {
      const list = await this.api<ChatThreadList>('/api/chat/threads');
      const latest = list.items[0];
      if (
        latest &&
        this.now() - latest.updatedAt < CHAT_THREAD_RECENT_MS &&
        !this.state.threadId &&
        !this.state.messages.length
      )
        await this.load(latest.id, { quiet: true });
    } catch {
      // No history: a new chat.
    }
  }

  /** Opens a saved conversation; `false` when it is gone (the panel stays on a new chat). */
  async load(id: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
    // An explicit choice (History, an Activity link) wins over the panel's opening pick.
    this.opened = true;
    if (this.state.streaming && this.state.threadId !== id) this.abortRun();
    if (this.state.streaming) return true;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    const userId = this.userId;
    this.set({ loading: true, notice: null, restore: null });
    try {
      const detail = await this.api<ChatThreadDetail>(
        `/api/chat/threads/${encodeURIComponent(id)}`,
        { signal: controller.signal },
      );
      if (this.loadController !== controller || this.userId !== userId) return false;
      this.renamed.clear();
      this.set({
        threadId: detail.thread.id,
        title: detail.thread.title,
        messages: detail.messages.map(fromStored),
        notConfigured: false,
      });
      if (userId) this.memory.set(userId, detail.thread.id);
      return true;
    } catch (err) {
      if (this.loadController !== controller) return false;
      if (err instanceof ApiError && err.status === 404) {
        if (userId) this.memory.set(userId, null);
        if (!opts.quiet) this.set({ notice: 'This conversation no longer exists' });
      } else if (!opts.quiet) {
        this.set({ notice: err instanceof Error ? err.message : String(err) });
      }
      return false;
    } finally {
      if (this.loadController === controller) {
        this.loadController = null;
        this.set({ loading: false });
      }
    }
  }

  /** Asks `text`; ignored while an answer streams or when empty. */
  send(text: string): void {
    const question = text.trim().slice(0, CHAT_MAX_CHARS);
    if (!question || this.state.streaming || this.state.loading) return;
    const user: UserMessage = { id: this.nextId(), role: 'user', text: question, seq: null };
    this.set({ messages: [...this.state.messages, user], notice: null, restore: null });
    void this.run(user.id, question);
  }

  /**
   * F17-R2 / D-155: asks the server to stop the turn (stored as `stopped`, answered once saved),
   * then aborts the stream; the partial answer stays.
   */
  stop(): void {
    const controller = this.controller;
    if (!controller || this.stopping === controller) return;
    this.stopping = controller;
    const threadId = this.state.threadId;
    if (!threadId) {
      controller.abort();
      return;
    }
    void this.api(`/api/chat/threads/${encodeURIComponent(threadId)}/stop`, { method: 'POST' })
      .catch(() => {})
      .finally(() => controller.abort());
  }

  /**
   * Asks the last question again, replacing the failed or stopped answer. D-155: a stored failed
   * reply is re-run in place (`retryOf`, no second user message); an answer the server never
   * stored is re-sent as a new turn.
   */
  retry(): void {
    if (this.state.streaming) return;
    const msgs = this.state.messages;
    const failed = msgs.at(-1);
    const user = msgs.at(-2);
    if (failed?.role !== 'assistant' || user?.role !== 'user') return;
    if (isStored(failed) && isStored(user) && RETRYABLE.has(failed.status)) {
      this.set({ messages: msgs.slice(0, -1), notice: null, restore: null });
      void this.run(user.id, user.text, failed.id);
      return;
    }
    if (isStored(user) && this.state.threadId) {
      // The reply was cut before it was saved here: the server has its outcome by now.
      const threadId = this.state.threadId;
      void this.load(threadId, { quiet: true }).then((ok) => {
        const [u, a] = this.state.messages.slice(-2);
        if (ok && a?.role === 'assistant' && isStored(a) && RETRYABLE.has(a.status) && u)
          this.retry();
      });
      return;
    }
    this.set({ messages: msgs.slice(0, -1), notice: null, restore: null });
    void this.run(user.id, user.text);
  }

  /** D-135: a global preview card's state (local only). */
  setPreviewStatus(
    previewId: string,
    status: WidgetPreview['status'],
    /** The dashboard it was added to (the card links to it). */
    dashboardId?: string,
  ): void {
    this.set({
      messages: this.state.messages.map((m) =>
        m.role === 'assistant' && m.previews?.some((p) => p.id === previewId)
          ? {
              ...m,
              previews: m.previews.map((p) =>
                p.id === previewId
                  ? { ...p, status, dashboardId: dashboardId ?? p.dashboardId }
                  : p,
              ),
            }
          : m,
      ),
    });
  }

  /** "New chat": an empty conversation (no server row until the first message). */
  clear(): void {
    this.abortRun();
    this.loadController?.abort();
    this.loadController = null;
    this.renamed.clear();
    if (this.userId) this.memory.set(this.userId, null);
    this.set({
      ...initial,
      history: this.state.history,
    });
  }

  // ---- history (F28 §5) ----

  /** The first page of the history, filtered by title (`q`). */
  async loadHistory(q = this.state.history.q): Promise<void> {
    await this.fetchHistory(q, null);
  }

  /** The next 50 rows. */
  async loadMore(): Promise<void> {
    const { nextCursor, status } = this.state.history;
    if (!nextCursor || status === 'loading') return;
    await this.fetchHistory(this.state.history.q, nextCursor);
  }

  private historySeq = 0;

  private async fetchHistory(q: string, before: string | null): Promise<void> {
    const seq = ++this.historySeq;
    this.setHistory({ status: 'loading', q, error: null });
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim().slice(0, 60));
    if (before) params.set('before', before);
    const qs = params.toString();
    try {
      const list = await this.api<ChatThreadList>(`/api/chat/threads${qs ? `?${qs}` : ''}`);
      if (seq !== this.historySeq) return;
      this.setHistory({
        status: 'ready',
        items: before ? [...this.state.history.items, ...list.items] : list.items,
        nextCursor: list.nextCursor,
      });
    } catch (err) {
      if (seq !== this.historySeq) return;
      this.setHistory({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Renames a thread (`PATCH`); throws the server's error (shown inline by the row). */
  async rename(id: string, title: string): Promise<void> {
    const summary = await this.api<ChatThreadSummary>(
      `/api/chat/threads/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { title } },
    );
    this.setHistory({
      items: this.state.history.items.map((t) => (t.id === id ? summary : t)),
    });
    if (this.state.threadId === id) this.set({ title: summary.title });
  }

  /**
   * Deletes a thread; resolves `true` when it was the open one (the panel turns into a new chat
   * and shows "Conversation deleted").
   */
  async remove(id: string): Promise<boolean> {
    try {
      await this.api(`/api/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    this.setHistory({ items: this.state.history.items.filter((t) => t.id !== id) });
    if (this.state.threadId !== id) return false;
    this.clear();
    return true;
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  // ---- one turn ----

  private async run(userId: string, message: string, retryOf?: string): Promise<void> {
    const id = this.nextId();
    const answer: AssistantMessage = {
      id,
      role: 'assistant',
      text: '',
      tools: [],
      reports: [],
      entities: [],
      seq: null,
      status: 'streaming',
      error: null,
    };
    const controller = new AbortController();
    this.controller = controller;
    this.set({ messages: [...this.state.messages, answer], streaming: true });
    let ended = false;
    let reload = false;
    const onEvent = (e: ChatEvent) => {
      if (this.controller !== controller || ended) return;
      if (e.type === 'error' || e.type === 'done') ended = true;
      this.apply(userId, id, e);
    };
    const threadId = this.state.threadId;
    const body: ChatRequest = {
      ...(threadId ? { threadId } : {}),
      message,
      ...(retryOf ? { retryOf } : {}),
    };
    try {
      await this.transport(body, onEvent, controller.signal);
      if (this.controller !== controller) return;
      // D-155: after Stop the server ends the stream (no `done`); that is not a cut.
      if (!ended) this.finish(id, this.stopping === controller ? 'stopped' : 'interrupted', null);
    } catch (err) {
      if (this.controller !== controller) return;
      if (controller.signal.aborted) {
        this.finish(id, 'stopped', null);
      } else if (isInterruption(err)) {
        this.finish(id, 'interrupted', null);
      } else if (err instanceof ChatHttpError && err.code === 'chat_busy') {
        // F28: a turn already runs in this conversation (another tab): the prompt goes back.
        this.set({
          messages: this.state.messages.filter(
            (m) => m.id !== id && (retryOf !== undefined || m.id !== userId),
          ),
          notice: 'Another reply is in progress in this conversation',
          restore: retryOf ? null : message,
        });
        reload = !!retryOf;
      } else if (retryOf && err instanceof ChatHttpError && err.status === 409) {
        // D-155 `not_retryable`: the stored thread shows how that turn ended.
        this.set({ messages: this.state.messages.filter((m) => m.id !== id) });
        reload = true;
      } else {
        const http = err instanceof ChatHttpError ? err : null;
        if (http?.status === 401) this.session?.expire?.();
        this.finish(id, 'error', {
          code: http?.code ?? 'failed',
          message: http?.message ?? ERROR_TEXT.failed,
        });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        if (this.stopping === controller) this.stopping = null;
        this.set({ streaming: false });
        if (reload && this.state.threadId) void this.load(this.state.threadId, { quiet: true });
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
      case 'report':
        return this.update(id, (m) => ({
          reports: [...m.reports.filter((r) => r.id !== e.report.id), e.report],
        }));
      case 'entities':
        return this.update(id, (m) => ({ entities: [...m.entities, ...e.items] }));
      case 'dashboard_created':
        dashboardEvents.emit({ kind: 'created', dashboardId: e.dashboard.id });
        return this.update(id, (m) => ({
          dashboards: [...(m.dashboards ?? []), { summary: e.dashboard, url: e.url }],
        }));
      case 'action_proposed':
        return this.update(id, (m) => ({
          actions: [...(m.actions ?? []).filter((a) => a.id !== e.action.id), e.action],
        }));
      case 'widget_preview':
        return this.update(id, (m) => ({
          previews: [...(m.previews ?? []).filter((p) => p.id !== e.preview.id), e.preview],
        }));
      case 'thread_saved':
        if (e.chat) this.adopt(userId, id, e.chat);
        return;
      case 'error':
        return this.finish(id, 'error', { code: e.code, message: e.message });
      case 'done':
        return this.finish(id, 'done', null);
    }
  }

  /** F28: the server stored this turn's messages: take its thread id, title and message ids. */
  private adopt(
    userId: string,
    id: string,
    chat: { threadId: string; title: string; messages: ChatThreadMessage[] },
  ): void {
    if (this.userId) this.memory.set(this.userId, chat.threadId);
    const stored = new Map(chat.messages.map((m) => [m.role, m]));
    const target = this.renamed.get(id) ?? id;
    const user = stored.get('user');
    const assistant = stored.get('assistant');
    this.set({
      threadId: chat.threadId,
      title: chat.title,
      messages: this.state.messages.map((m) => {
        if (m.id === userId && user) return { ...m, id: user.id, seq: user.seq };
        if (m.id === target && assistant && m.role === 'assistant')
          return { ...m, id: assistant.id, seq: assistant.seq };
        return m;
      }),
    });
    if (user && user.id !== userId) this.renamed.set(userId, user.id);
    if (assistant && assistant.id !== target) this.renamed.set(id, assistant.id);
    // A history list that is open shows this thread first.
    if (this.state.history.status !== 'idle') void this.loadHistory();
  }

  private finish(id: string, status: AssistantMessage['status'], error: ChatError | null): void {
    this.update(id, (m) => ({
      status,
      error,
      // Tools still spinning when the run ended did not finish.
      tools: m.tools.map((t) => (t.ok === null ? { ...t, ok: false } : t)),
    }));
    if (error?.code === 'not_configured') this.set({ notConfigured: true });
  }

  private update(id: string, patch: (m: AssistantMessage) => Partial<AssistantMessage>): void {
    const target = this.renamed.get(id) ?? id;
    this.set({
      messages: this.state.messages.map((m) =>
        m.id === target && m.role === 'assistant' ? { ...m, ...patch(m) } : m,
      ),
    });
  }

  private abortRun(): void {
    this.controller?.abort();
    this.controller = null;
    this.stopping = null;
  }

  /** Sign-out or another user: nothing of the previous user stays in memory. */
  private reset(): void {
    this.abortRun();
    this.loadController?.abort();
    this.loadController = null;
    this.renamed.clear();
    this.historySeq++;
    this.set(initial);
  }

  private currentUser(): string | null {
    const s = this.session?.getSnapshot();
    return s?.status === 'authenticated' && s.me ? s.me.user.id : null;
  }

  private nextId(): string {
    return `m${++this.seq}`;
  }

  private setHistory(patch: Partial<ChatHistory>): void {
    this.set({ history: { ...this.state.history, ...patch } });
  }

  private set(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

/** The app's conversation (created with the lazy panel chunk on first open). */
export const assistantStore = new AssistantStore({ session: sessionStore });
