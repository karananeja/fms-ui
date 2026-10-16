import {
  CHAT_THREAD_MESSAGES_MAX,
  CHAT_THREAD_PREVIEW_MAX,
  CHAT_THREADS_PAGE,
  CHAT_THREADS_PER_USER,
  CHAT_THREAD_TITLE_MAX,
  chatThreadExtrasSchema,
  type ChatThreadDetail,
  type ChatThreadExtras,
  type ChatThreadList,
  type ChatThreadMessage,
  type ChatThreadSummary,
  type ThreadOutcome,
} from '@shared/contract/index.ts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.ts';
import { transaction } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

interface ThreadRow {
  rid: number;
  id: string;
  user_id: string;
  title: string;
  title_auto: number;
  created_at: number;
  updated_at: number;
  preview: string | null;
  min_seq: number | null;
}
interface MessageRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  extras_json: string;
  outcome: ThreadOutcome;
  error_code: string | null;
  created_at: number;
}
const MESSAGE_COLUMNS = 'id, seq, role, text, extras_json, outcome, error_code, created_at';
const THREAD_COLUMNS = `t.rowid AS rid, t.id, t.user_id, t.title, t.title_auto, t.created_at, t.updated_at,
  (SELECT text FROM chat_messages WHERE thread_id = t.id AND role = 'user' ORDER BY seq DESC LIMIT 1) AS preview,
  (SELECT MIN(seq) FROM chat_messages WHERE thread_id = t.id) AS min_seq`;

/** Stored text of one message (as the dashboard thread, D-155 notes included). */
export const CHAT_MESSAGE_TEXT_MAX = 20_000;

export interface ChatAppend {
  role: 'user' | 'assistant';
  text: string;
  extras?: ChatThreadExtras;
  outcome?: ThreadOutcome;
  errorCode?: string;
}

/** A running global-chat turn (one per thread, in memory). */
export interface ChatRun {
  userId: string;
  stop: () => void;
  done: Promise<void>;
}

const notFound = () => new HttpError(404, 'not_found', 'Conversation not found');

/**
 * F28 (D-163): the global Ask FMS conversations in SQLite (`chat_threads`, `chat_messages`),
 * written through on every turn. Every method takes the caller's id; another user's thread is
 * 404. D-165: 200 threads per user (the least recently updated is dropped), 400 messages per
 * thread (oldest dropped).
 */
export class ChatThreads {
  /** The running turn per thread id (`chat_busy`, Stop). */
  readonly running = new Map<string, ChatRun>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {}

  list(userId: string, opts: { q?: string; before?: string } = {}): ChatThreadList {
    const where = ['t.user_id = ?'];
    const args: (string | number)[] = [userId];
    const q = opts.q?.trim().toLowerCase();
    if (q) {
      where.push('instr(lower(t.title), ?) > 0');
      args.push(q);
    }
    const cursor = opts.before ? decodeCursor(opts.before) : null;
    if (cursor) {
      where.push('(t.updated_at < ? OR (t.updated_at = ? AND t.rowid < ?))');
      args.push(cursor.at, cursor.at, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM chat_threads t WHERE ${where.join(' AND ')}
         ORDER BY t.updated_at DESC, t.rowid DESC LIMIT ?`,
      )
      .all(...args, CHAT_THREADS_PAGE + 1) as unknown as ThreadRow[];
    const more = rows.length > CHAT_THREADS_PAGE;
    const page = rows.slice(0, CHAT_THREADS_PAGE);
    const last = page.at(-1);
    return {
      items: page.map(toSummary),
      nextCursor: more && last ? `${last.updated_at}.${last.rid}` : null,
    };
  }

  summary(userId: string, id: string): ChatThreadSummary {
    return toSummary(this.row(userId, id));
  }

  get(userId: string, id: string): ChatThreadDetail {
    const thread = this.summary(userId, id);
    return { thread, messages: this.messages(userId, id) };
  }

  messages(userId: string, id: string): ChatThreadMessage[] {
    this.row(userId, id);
    const rows = this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE thread_id = ? ORDER BY seq`)
      .all(id) as unknown as MessageRow[];
    return rows.map(toMessage);
  }

  /** A new thread (auto title); creating the 201st drops the least recently updated one. */
  create(userId: string, title: string): ChatThreadSummary {
    const now = this.clock.now();
    const id = `thr-${randomUUID()}`;
    transaction(this.db, () => {
      this.db
        .prepare(
          'INSERT INTO chat_threads (id, user_id, title, title_auto, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
        )
        .run(id, userId, clipTitle(title), now, now);
      this.db
        .prepare(
          `DELETE FROM chat_threads WHERE user_id = ? AND id IN (
             SELECT id FROM chat_threads WHERE user_id = ?
             ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
        )
        .run(userId, userId, CHAT_THREADS_PER_USER);
    });
    return this.summary(userId, id);
  }

  rename(userId: string, id: string, title: string): ChatThreadSummary {
    this.row(userId, id);
    this.db
      .prepare('UPDATE chat_threads SET title = ?, title_auto = 0, updated_at = ? WHERE id = ?')
      .run(clipTitle(title), this.clock.now(), id);
    return this.summary(userId, id);
  }

  remove(userId: string, id: string): void {
    this.row(userId, id);
    this.db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
  }

  /** Appends one message and bumps `updated_at`; the thread keeps its newest 400 messages. */
  appendMessage(userId: string, id: string, msg: ChatAppend): ChatThreadMessage {
    return transaction(this.db, () => {
      this.row(userId, id);
      const { s } = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM chat_messages WHERE thread_id = ?')
        .get(id) as { s: number };
      const now = this.clock.now();
      const row: MessageRow = {
        id: `msg-${randomUUID()}`,
        seq: s + 1,
        role: msg.role,
        text: msg.text.slice(0, CHAT_MESSAGE_TEXT_MAX),
        extras_json: extrasJson(msg.extras),
        outcome: msg.outcome ?? 'done',
        error_code: msg.errorCode ?? null,
        created_at: now,
      };
      this.db
        .prepare(
          'INSERT INTO chat_messages (id, thread_id, seq, role, text, extras_json, outcome, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          row.id,
          id,
          row.seq,
          row.role,
          row.text,
          row.extras_json,
          row.outcome,
          row.error_code,
          now,
        );
      this.db
        .prepare('DELETE FROM chat_messages WHERE thread_id = ? AND seq <= ?')
        .run(id, row.seq - CHAT_THREAD_MESSAGES_MAX);
      this.db.prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(now, id);
      return toMessage(row);
    });
  }

  /** D-155: overwrites a stored assistant message in place (same id and seq) with a retry's reply. */
  replaceMessage(
    userId: string,
    id: string,
    messageId: string,
    msg: ChatAppend,
  ): ChatThreadMessage {
    return transaction(this.db, () => {
      this.row(userId, id);
      const now = this.clock.now();
      const res = this.db
        .prepare(
          "UPDATE chat_messages SET text = ?, extras_json = ?, outcome = ?, error_code = ?, created_at = ? WHERE id = ? AND thread_id = ? AND role = 'assistant'",
        )
        .run(
          msg.text.slice(0, CHAT_MESSAGE_TEXT_MAX),
          extrasJson(msg.extras),
          msg.outcome ?? 'done',
          msg.errorCode ?? null,
          now,
          messageId,
          id,
        );
      if (Number(res.changes) === 0) throw new HttpError(404, 'not_found', 'Message not found');
      this.db.prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(now, id);
      const stored = this.db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`)
        .get(messageId) as unknown as MessageRow;
      return toMessage(stored);
    });
  }

  /**
   * D-155: the turn a retry re-runs: `assistantId` must be the thread's last message, end other
   * than `done` and follow a user message; else 409 `not_retryable`.
   */
  retryTurn(
    userId: string,
    id: string,
    assistantId: string,
  ): { user: ChatThreadMessage; failed: ChatThreadMessage } {
    const rows = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE thread_id = ? ORDER BY seq DESC LIMIT 2`,
      )
      .all(this.row(userId, id).id) as unknown as MessageRow[];
    const [failed, user] = rows.map(toMessage);
    if (
      !user ||
      !failed ||
      failed.id !== assistantId ||
      failed.role !== 'assistant' ||
      failed.outcome === 'done' ||
      user.role !== 'user'
    )
      throw new HttpError(409, 'not_retryable', 'Only the latest failed reply can be retried');
    return { user, failed };
  }

  private row(userId: string, id: string): ThreadRow {
    const row = this.db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM chat_threads t WHERE t.id = ?`)
      .get(id) as unknown as ThreadRow | undefined;
    if (!row || row.user_id !== userId) throw notFound();
    return row;
  }
}

/** `<updatedAt>.<rowid>` of the last row of the previous page. */
function decodeCursor(s: string): { at: number; id: number } | null {
  const [at, id] = s.split('.').map(Number);
  return Number.isFinite(at) && Number.isFinite(id) ? { at: at!, id: id! } : null;
}

const clipTitle = (t: string) => t.trim().slice(0, CHAT_THREAD_TITLE_MAX) || 'New chat';

function extrasJson(extras: ChatThreadExtras | undefined): string {
  if (!extras) return '{}';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extras)) if (Array.isArray(v) && v.length) out[k] = v;
  return JSON.stringify(out);
}

function toSummary(r: ThreadRow): ChatThreadSummary {
  const preview = (r.preview ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: r.id,
    title: r.title,
    titleAuto: r.title_auto === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview:
      preview.length > CHAT_THREAD_PREVIEW_MAX
        ? `${preview.slice(0, CHAT_THREAD_PREVIEW_MAX - 1)}…`
        : preview,
    trimmed: (r.min_seq ?? 1) > 1,
  };
}

function toMessage(m: MessageRow): ChatThreadMessage {
  const parsed = chatThreadExtrasSchema.safeParse(JSON.parse(m.extras_json));
  return {
    id: m.id,
    seq: m.seq,
    role: m.role,
    text: m.text,
    extras: parsed.success ? parsed.data : {},
    outcome: m.outcome,
    errorCode: m.error_code,
    createdAt: m.created_at,
  };
}
