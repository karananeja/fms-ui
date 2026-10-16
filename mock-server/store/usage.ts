import {
  IST_OFFSET_MS,
  USAGE_CHATS,
  type UsageByChat,
  type UsageByModel,
  type UsageChat,
  type UsageDay,
  type UsageSource,
  type UsageTotals,
  type UsageTurn,
} from '@shared/contract/index.ts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Clock } from '../clock.ts';
import { estimateCost, MODEL_PRICES } from './usage-prices.ts';

const DAY = 86_400_000;

/** IST midnight on or before `t`. */
export const istDayStart = (t: number) =>
  Math.floor((t + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;
const istDate = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Token counts as the providers report them (`Usage` in `assistant/provider.ts`). */
export interface RunUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Input of {@link AiUsage.record}: one model run. */
export interface UsageRecordInput {
  userId: string;
  chat: UsageChat;
  threadId?: string | null;
  dashboardId?: string | null;
  /** `anthropic` | `openai` | `xai` | `fake`. */
  provider: string;
  model: string;
  /** Whose key paid: the user's own, the server's, or the fake model (no cost). */
  source: UsageSource;
  /** Tool steps of the run. */
  steps?: number;
  usage: RunUsage;
  /** The run's end reason (`done`, `error`, `client-abort`, `timeout`, `provider-cut`, …). */
  outcome: string;
  /** Defaults to the clock's now. */
  at?: number;
}

/** Row filter of every query. `userId: null` = the whole organisation. */
export interface UsageFilter {
  userId: string | null;
  from: number;
  to: number;
  includeFake?: boolean;
  provider?: string;
}

interface Row {
  id: string;
  user_id: string;
  at: number;
  chat: UsageChat;
  thread_id: string | null;
  dashboard_id: string | null;
  provider: string;
  model: string;
  source: UsageSource;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  outcome: string;
  cost_usd: number | null;
}

interface AggRow {
  turns: number;
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  unpriced: number | null;
}

const AGG = `COUNT(*) AS turns, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
  SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write,
  SUM(cost_usd) AS cost, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced`;

const DAY_EXPR = `strftime('%Y-%m-%d', (at + ${IST_OFFSET_MS}) / 1000, 'unixepoch')`;

export const emptyTotals = (): UsageTotals => totalsOf({ turns: 0 } as AggRow);

function totalsOf(r: AggRow): UsageTotals {
  const inputTokens = r.input ?? 0;
  const cacheReadTokens = r.cache_read ?? 0;
  const cacheWriteTokens = r.cache_write ?? 0;
  const allInput = inputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    turns: r.turns,
    inputTokens,
    outputTokens: r.output ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitRate: allInput > 0 ? cacheReadTokens / allInput : null,
    costUsd: r.cost ?? null,
    unpricedTurns: r.unpriced ?? 0,
  };
}

const turnOf = (r: Row): UsageTurn => ({
  id: r.id,
  userId: r.user_id,
  at: r.at,
  chat: r.chat,
  threadId: r.thread_id,
  dashboardId: r.dashboard_id,
  provider: r.provider,
  model: r.model,
  source: r.source,
  steps: r.steps,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cacheReadTokens: r.cache_read_tokens,
  cacheWriteTokens: r.cache_write_tokens,
  outcome: r.outcome,
  costUsd: r.cost_usd,
});

/**
 * F30 AI token usage (`ai_usage`, migration v15): one row per model run, queried straight from
 * SQLite (no cache — rows are append-only and the queries are small aggregates over an index).
 * Fake-model runs are stored (cost null) but left out unless `includeFake`.
 */
export class AiUsage {
  /** Called after each recorded run (e.g. to push a live update). */
  onRecord?: (turn: UsageTurn) => void;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: Clock,
  ) {}

  /** Stores one run; the cost is estimated from the price table (null for fake / unpriced). */
  record(input: UsageRecordInput): UsageTurn {
    const tokens = {
      inputTokens: Math.max(0, Math.round(input.usage.inputTokens)),
      outputTokens: Math.max(0, Math.round(input.usage.outputTokens)),
      cacheReadTokens: Math.max(0, Math.round(input.usage.cacheReadInputTokens)),
      cacheWriteTokens: Math.max(0, Math.round(input.usage.cacheCreationInputTokens)),
    };
    const fake = input.source === 'fake' || input.provider === 'fake';
    const turn: UsageTurn = {
      id: randomUUID(),
      userId: input.userId,
      at: input.at ?? this.clock.now(),
      chat: input.chat,
      threadId: input.threadId ?? null,
      dashboardId: input.dashboardId ?? null,
      provider: input.provider,
      model: input.model,
      source: fake ? 'fake' : input.source,
      steps: Math.max(0, Math.round(input.steps ?? 0)),
      ...tokens,
      outcome: input.outcome,
      costUsd: fake ? null : estimateCost(input.model, tokens),
    };
    this.db
      .prepare(
        `INSERT INTO ai_usage (id, user_id, at, chat, thread_id, dashboard_id, provider, model,
          source, steps, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          outcome, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turn.id,
        turn.userId,
        turn.at,
        turn.chat,
        turn.threadId,
        turn.dashboardId,
        turn.provider,
        turn.model,
        turn.source,
        turn.steps,
        turn.inputTokens,
        turn.outputTokens,
        turn.cacheReadTokens,
        turn.cacheWriteTokens,
        turn.outcome,
        turn.costUsd,
      );
    this.onRecord?.(turn);
    return turn;
  }

  /** `[from, to)` of the last `days` IST days, today included. */
  window(days: number, now = this.clock.now()): { from: number; to: number } {
    return { from: istDayStart(now) - (days - 1) * DAY, to: now + 1 };
  }

  private where(f: UsageFilter): { sql: string; args: SQLInputValue[] } {
    const parts = ['at >= ?', 'at < ?'];
    const args: SQLInputValue[] = [f.from, f.to];
    if (f.userId !== null) {
      parts.push('user_id = ?');
      args.push(f.userId);
    }
    if (f.provider) {
      parts.push('provider = ?');
      args.push(f.provider);
    }
    if (!f.includeFake) parts.push("source <> 'fake'");
    return { sql: `WHERE ${parts.join(' AND ')}`, args };
  }

  totals(f: UsageFilter): UsageTotals {
    const w = this.where(f);
    const r = this.db.prepare(`SELECT ${AGG} FROM ai_usage ${w.sql}`).get(...w.args) as unknown;
    return totalsOf(r as AggRow);
  }

  /** Today, last 7 and last 30 IST days. */
  summary(
    userId: string | null,
    opts: { includeFake?: boolean; provider?: string } = {},
  ): { today: UsageTotals; d7: UsageTotals; d30: UsageTotals } {
    const at = (days: number) => this.totals({ userId, ...opts, ...this.window(days) });
    return { today: at(1), d7: at(7), d30: at(30) };
  }

  /** One entry per IST day of the last `days` days (zeros included), oldest first. */
  daily(
    userId: string | null,
    days: number,
    opts: { includeFake?: boolean; provider?: string } = {},
  ): UsageDay[] {
    const range = this.window(days);
    const w = this.where({ userId, ...opts, ...range });
    const rows = this.db
      .prepare(`SELECT ${DAY_EXPR} AS day, ${AGG} FROM ai_usage ${w.sql} GROUP BY day`)
      .all(...w.args) as unknown as (AggRow & { day: string })[];
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return Array.from({ length: days }, (_, k) => {
      const day = istDate(range.from + k * DAY + DAY / 2);
      const r = byDay.get(day);
      return { day, ...(r ? totalsOf(r) : emptyTotals()) };
    });
  }

  byModel(f: UsageFilter): UsageByModel[] {
    const w = this.where(f);
    const rows = this.db
      .prepare(
        `SELECT provider, model, ${AGG} FROM ai_usage ${w.sql} GROUP BY provider, model
         ORDER BY turns DESC, provider, model`,
      )
      .all(...w.args) as unknown as (AggRow & { provider: string; model: string })[];
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      priced: r.provider !== 'fake' && r.model in MODEL_PRICES,
      ...totalsOf(r),
    }));
  }

  /** Global vs dashboard vs auto-title; every chat kind is listed (zeros included). */
  byChat(f: UsageFilter): UsageByChat[] {
    const w = this.where(f);
    const rows = this.db
      .prepare(`SELECT chat, ${AGG} FROM ai_usage ${w.sql} GROUP BY chat`)
      .all(...w.args) as unknown as (AggRow & { chat: UsageChat })[];
    const map = new Map(rows.map((r) => [r.chat, r]));
    return USAGE_CHATS.map((chat) => {
      const r = map.get(chat);
      return { chat, ...(r ? totalsOf(r) : emptyTotals()) };
    });
  }

  /** Admin: totals per user id, biggest first. */
  byUser(f: UsageFilter): (UsageTotals & { userId: string })[] {
    const w = this.where({ ...f, userId: f.userId });
    const rows = this.db
      .prepare(
        `SELECT user_id, ${AGG} FROM ai_usage ${w.sql} GROUP BY user_id
         ORDER BY COALESCE(SUM(cost_usd), 0) DESC,
           SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC`,
      )
      .all(...w.args) as unknown as (AggRow & { user_id: string })[];
    return rows.map((r) => ({ userId: r.user_id, ...totalsOf(r) }));
  }

  /** The most expensive runs (cost, then total tokens, then newest). */
  topTurns(f: UsageFilter, limit = 10): UsageTurn[] {
    const w = this.where(f);
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_usage ${w.sql}
         ORDER BY COALESCE(cost_usd, -1) DESC,
           (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC, at DESC
         LIMIT ?`,
      )
      .all(...w.args, limit) as unknown as Row[];
    return rows.map(turnOf);
  }

  /** Every matching run, newest first (CSV export). */
  rows(f: UsageFilter, limit = 100_000): UsageTurn[] {
    const w = this.where(f);
    const rows = this.db
      .prepare(`SELECT * FROM ai_usage ${w.sql} ORDER BY at DESC LIMIT ?`)
      .all(...w.args, limit) as unknown as Row[];
    return rows.map(turnOf);
  }
}
