import {
  adminUsageQuerySchema,
  IST_OFFSET_MS,
  USAGE_CSV_HEADER,
  USAGE_RANGE_DAYS,
  usageQuerySchema,
  type UsageRange,
  type UsageReport,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { authorize, parse, type MockContext } from '../context.ts';
import { PRICES_CHECKED } from '../store/usage-prices.ts';

/** `2026-10-16 14:05:09` in IST. */
const istStamp = (t: number) =>
  new Date(t + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function userLabel(ctx: MockContext, userId: string) {
  try {
    const u = ctx.accounts.user(userId);
    return { name: u.name, email: u.email };
  } catch {
    return { name: 'Deleted user', email: '' };
  }
}

function report(
  ctx: MockContext,
  q: { range: UsageRange; includeFake: boolean; userId: string | null; provider?: string },
  admin: boolean,
): UsageReport {
  const days = USAGE_RANGE_DAYS[q.range];
  const { from, to } = ctx.usage.window(days);
  const opts = { includeFake: q.includeFake, provider: q.provider };
  const f = { userId: q.userId, from, to, ...opts };
  return {
    range: q.range,
    from,
    to,
    includeFake: q.includeFake,
    summary: ctx.usage.summary(q.userId, opts),
    totals: ctx.usage.totals(f),
    daily: ctx.usage.daily(q.userId, days, opts),
    byModel: ctx.usage.byModel(f),
    byChat: ctx.usage.byChat(f),
    topTurns: ctx.usage.topTurns(f, 10),
    ...(admin
      ? {
          byUser: ctx.usage.byUser(f).map((u) => ({ ...u, ...userLabel(ctx, u.userId) })),
        }
      : {}),
    pricesChecked: PRICES_CHECKED,
  };
}

/**
 * F30, prefix `/api`:
 * - `GET /me/usage?range=7d|30d|90d&includeFake=1` (`chat.use`): the caller's own runs only.
 * - `GET /admin/usage?range=&userId=&provider=&includeFake=` (`roles.manage`): the whole
 *   organisation (or one user), plus `byUser`.
 * - `GET /admin/usage.csv?range=&userId=&provider=&includeFake=` (`roles.manage`): every run.
 */
export async function usageRoutes(app: FastifyInstance) {
  const ctx = app.mock;

  app.get('/me/usage', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const q = parse(usageQuerySchema, req.query);
    return report(ctx, { ...q, userId: user.id }, false);
  });

  app.get('/admin/usage', async (req) => {
    authorize(ctx, req, 'roles.manage');
    const q = parse(adminUsageQuerySchema, req.query);
    return report(ctx, { ...q, userId: q.userId ?? null }, true);
  });

  app.get('/admin/usage.csv', async (req, reply) => {
    authorize(ctx, req, 'roles.manage');
    const q = parse(adminUsageQuerySchema, req.query);
    const { from, to } = ctx.usage.window(USAGE_RANGE_DAYS[q.range]);
    const rows = ctx.usage.rows({
      userId: q.userId ?? null,
      from,
      to,
      includeFake: q.includeFake,
      provider: q.provider,
    });
    const emails = new Map<string, string>();
    const email = (id: string) => {
      if (!emails.has(id)) emails.set(id, userLabel(ctx, id).email);
      return emails.get(id)!;
    };
    const lines = [
      USAGE_CSV_HEADER.join(','),
      ...rows.map((r) =>
        [
          istStamp(r.at),
          email(r.userId),
          r.chat,
          r.threadId,
          r.dashboardId,
          r.provider,
          r.model,
          r.source,
          r.steps,
          r.inputTokens,
          r.outputTokens,
          r.cacheReadTokens,
          r.cacheWriteTokens,
          r.outcome,
          r.costUsd === null ? null : r.costUsd.toFixed(6),
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ai-usage-${q.range}.csv"`)
      .send(lines.join('\n') + '\n');
  });
}
