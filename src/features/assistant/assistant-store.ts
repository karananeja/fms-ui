import {
  CHAT_MAX_CHARS,
  CHAT_MAX_TURNS,
  type ChatEvent,
  type ChatTurn,
  type DashboardLink,
  type EntityRef,
  type ReportDescriptor,
} from '@shared/contract/assistant.ts';
import type { WidgetPreview } from '@shared/contract/dashboards.ts';
import { sessionStore, type SessionState } from '@/features/auth/session/session-store';
import { dashboardEvents } from './dashboard-events.ts';
import {
  ChatHttpError,
  httpChatTransport,
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
  /** D-135: widget previews (panel session only; the global chat has no server thread). */
  previews?: readonly WidgetPreview[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  error: ChatError | null;
}

export type Message = UserMessage | AssistantMessage;

export interface AssistantState {
  messages: readonly Message[];
  /** True while an answer streams (the composer shows Stop). */
  streaming: boolean;
  /** F17-R5: the server has no model configured; the panel shows a set-up notice instead. */
  notConfigured: boolean;
}

export interface AssistantSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Pick<SessionState, 'status' | 'me'>;
  expire?(): void;
}

export interface AssistantStoreDeps {
  transport?: ChatTransport;
  session?: AssistantSession;
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

const initial: AssistantState = { messages: [], streaming: false, notConfigured: false };

/**
 * F17-R6: the assistant conversation (main thread, low volume). Sends the whole text transcript
 * (≤ 30 turns, oldest dropped first) and folds the streamed `ChatEvent`s into the last answer.
 * Lives for the session: closing the panel keeps it; a different user (or sign-out) clears it.
 */
export class AssistantStore {
  private state: AssistantState = initial;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private userId: string | null = null;
  private seq = 0;
  private readonly transport: ChatTransport;
  private readonly session: AssistantSession | undefined;

  constructor(deps: AssistantStoreDeps = {}) {
    this.transport = deps.transport ?? httpChatTransport;
    this.session = deps.session;
    if (this.session) {
      this.userId = this.currentUser();
      this.session.subscribe(() => {
        const id = this.currentUser();
        if (id !== this.userId) {
          this.userId = id;
          this.clear();
        }
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AssistantState => this.state;

  /** Asks `text`; ignored while an answer streams or when empty. */
  send(text: string): void {
    const question = text.trim().slice(0, CHAT_MAX_CHARS);
    if (!question || this.state.streaming) return;
    const user: UserMessage = { id: this.nextId(), role: 'user', text: question };
    this.set({ messages: [...this.state.messages, user] });
    void this.run();
  }

  /** F17-R2: aborts the fetch (the server cancels the run); the partial answer stays. */
  stop(): void {
    this.controller?.abort();
  }

  /** Asks the last question again, replacing the failed or stopped answer. */
  retry(): void {
    if (this.state.streaming) return;
    const last = this.state.messages.at(-1);
    if (last?.role !== 'assistant') return;
    this.set({ messages: this.state.messages.slice(0, -1) });
    void this.run();
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

  /** "New chat" (also on user change): drops the conversation and any running answer. */
  clear(): void {
    this.controller?.abort();
    this.controller = null;
    this.set(initial);
  }

  /** The request body: answered text turns, then the question; ≤ 30, starting with a user turn. */
  transcript(): ChatTurn[] {
    const msgs = this.state.messages;
    const turns: ChatTurn[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]!;
      if (m.role !== 'user') continue;
      const answer = msgs[i + 1];
      if (!answer) {
        turns.push({ role: 'user', content: m.text });
      } else if (answer.role === 'assistant' && answer.text.trim()) {
        // Unanswered exchanges (errors, stopped before any text) are left out: turns alternate.
        turns.push({ role: 'user', content: m.text }, { role: 'assistant', content: answer.text });
      }
    }
    let out = turns.slice(-CHAT_MAX_TURNS);
    if (out[0]?.role === 'assistant') out = out.slice(1);
    return out;
  }

  private async run(): Promise<void> {
    const messages = this.transcript();
    const id = this.nextId();
    const answer: AssistantMessage = {
      id,
      role: 'assistant',
      text: '',
      tools: [],
      reports: [],
      entities: [],
      status: 'streaming',
      error: null,
    };
    const controller = new AbortController();
    this.controller = controller;
    this.set({ messages: [...this.state.messages, answer], streaming: true });
    let ended = false;
    const onEvent = (e: ChatEvent) => {
      if (this.controller !== controller || ended) return;
      if (e.type === 'error' || e.type === 'done') ended = true;
      this.apply(id, e);
    };
    try {
      await this.transport({ messages }, onEvent, controller.signal);
      if (this.controller !== controller) return;
      if (!ended)
        this.finish(id, 'error', { code: 'failed', message: 'The answer was cut off. Try again.' });
    } catch (err) {
      if (this.controller !== controller) return;
      if (controller.signal.aborted) {
        this.finish(id, 'stopped', null);
      } else {
        const http = err instanceof ChatHttpError ? err : null;
        if (http?.status === 401) this.session?.expire?.();
        this.finish(id, 'error', {
          code: http?.code ?? 'failed',
          message: http?.message ?? String(err),
        });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.set({ streaming: false });
      }
    }
  }

  private apply(id: string, e: ChatEvent): void {
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
      case 'widget_preview':
        return this.update(id, (m) => ({
          previews: [...(m.previews ?? []).filter((p) => p.id !== e.preview.id), e.preview],
        }));
      case 'error':
        return this.finish(id, 'error', { code: e.code, message: e.message });
      case 'done':
        return this.finish(id, 'done', null);
    }
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
    this.set({
      messages: this.state.messages.map((m) =>
        m.id === id && m.role === 'assistant' ? { ...m, ...patch(m) } : m,
      ),
    });
  }

  private currentUser(): string | null {
    const s = this.session?.getSnapshot();
    return s?.status === 'authenticated' && s.me ? s.me.user.id : null;
  }

  private nextId(): string {
    return `m${++this.seq}`;
  }

  private set(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

/** The app's conversation (created with the lazy panel chunk on first open). */
export const assistantStore = new AssistantStore({ session: sessionStore });
