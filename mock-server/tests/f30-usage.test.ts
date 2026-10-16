// @vitest-environment node
import { USAGE_CSV_HEADER, usageReportSchema } from '@shared/contract/index.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimateCost } from '../store/usage-prices.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F30: usage store (record → aggregates, cost estimate) and the /me + /admin endpoints. */

let srv: Awaited<ReturnType<typeof startServer>>;
let admin: string;
let ops: string;
let opsId: string;
let adminId: string;

const usage = (input: number, output: number, read = 0, write = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: read,
  cacheCreationInputTokens: write,
});

beforeAll(async () => {
  srv = await startServer();
  admin = await srv.login(SEED_USERS.superadmin);
  ops = await srv.login(SEED_USERS.ops);
  opsId = srv.ctx.accounts.userByEmail(SEED_USERS.ops.email)!.id;
  adminId = srv.ctx.accounts.userByEmail(SEED_USERS.superadmin.email)!.id;
  const u = srv.ctx.usage;
  const now = srv.ctx.clock.now();
  u.record({
    userId: opsId,
    chat: 'global',
    threadId: 't1',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    source: 'user',
    steps: 2,
    usage: usage(1000, 500, 3000, 1000),
    outcome: 'done',
  });
  u.record({
    userId: opsId,
    chat: 'dashboard',
    dashboardId: 'd1',
    provider: 'xai',
    model: 'grok-9',
    source: 'server',
    usage: usage(2000, 100),
    outcome: 'done',
  });
  // 10 days ago: inside 30d, outside 7d.
  u.record({
    userId: opsId,
    chat: 'title',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    source: 'user',
    usage: usage(100, 10),
    outcome: 'done',
    at: now - 10 * 86_400_000,
  });
  u.record({
    userId: opsId,
    chat: 'global',
    provider: 'fake',
    model: 'fake',
    source: 'fake',
    usage: usage(9999, 9999),
    outcome: 'done',
  });
  u.record({
    userId: adminId,
    chat: 'global',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    source: 'server',
    usage: usage(1_000_000, 0),
    outcome: 'error',
  });
});
afterAll(() => srv.close());

describe('F30 usage store', () => {
  it('estimates cost for priced models only', () => {
    expect(
      estimateCost('claude-sonnet-5-5', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
      }),
    ).toBeCloseTo((1000 * 2 + 500 * 10 + 3000 * 0.2 + 1000 * 2.5) / 1e6, 10);
    expect(
      estimateCost('grok-9', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });

  it('summary, daily and breakdowns (fake excluded)', () => {
    const u = srv.ctx.usage;
    const s = u.summary(opsId);
    expect(s.today.turns).toBe(2);
    expect(s.d7.inputTokens).toBe(3000);
    expect(s.d30.turns).toBe(3);
    expect(s.today.cacheHitRate).toBeCloseTo(3000 / (3000 + 3000 + 1000), 10);
    expect(s.today.unpricedTurns).toBe(1);
    expect(s.today.costUsd).toBeCloseTo(0.0101, 10);
    expect(u.summary(opsId, { includeFake: true }).today.turns).toBe(3);

    const daily = u.daily(opsId, 30);
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)!.turns).toBe(2);
    expect(daily.reduce((n, d) => n + d.turns, 0)).toBe(3);

    const f = { userId: opsId, ...u.window(30) };
    const models = u.byModel(f);
    expect(models.find((m) => m.model === 'grok-9')).toMatchObject({
      priced: false,
      costUsd: null,
    });
    expect(models.find((m) => m.model === 'claude-sonnet-5-5')?.priced).toBe(true);
    expect(u.byChat(f).map((c) => [c.chat, c.turns])).toEqual([
      ['global', 1],
      ['dashboard', 1],
      ['title', 1],
    ]);
    expect(u.topTurns(f)[0]!.model).toBe('claude-sonnet-5-5');
  });
});

describe('F30 usage endpoints', () => {
  it('/api/me/usage returns only the caller', async () => {
    const res = await srv.api('GET', '/api/me/usage?range=7d', {
      cookie: ops,
      schema: usageReportSchema,
    });
    expect(res.status).toBe(200);
    expect(res.body.totals.turns).toBe(2);
    expect(res.body.byUser).toBeUndefined();
    expect(res.body.topTurns.every((t) => t.userId === opsId)).toBe(true);
    const mine = await srv.api('GET', '/api/me/usage?range=30d', {
      cookie: admin,
      schema: usageReportSchema,
    });
    expect(mine.body.totals.turns).toBe(1);
    expect(mine.body.totals.costUsd).toBeCloseTo(4, 10);
  });

  it('admin routes need roles.manage; admin sees everyone', async () => {
    expect((await srv.api('GET', '/api/admin/usage', { cookie: ops })).status).toBe(403);
    expect((await srv.api('GET', '/api/admin/usage.csv', { cookie: ops })).status).toBe(403);
    const res = await srv.api('GET', '/api/admin/usage?range=30d', {
      cookie: admin,
      schema: usageReportSchema,
    });
    expect(res.body.totals.turns).toBe(4);
    expect(res.body.byUser?.map((u) => u.email)).toEqual([
      SEED_USERS.superadmin.email,
      SEED_USERS.ops.email,
    ]);
    const one = await srv.api('GET', `/api/admin/usage?range=30d&userId=${opsId}`, {
      cookie: admin,
      schema: usageReportSchema,
    });
    expect(one.body.totals.turns).toBe(3);
  });

  it('CSV export', async () => {
    const res = await fetch(`${srv.base}/api/admin/usage.csv?range=30d`, {
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe(USAGE_CSV_HEADER.join(','));
    expect(lines).toHaveLength(5);
  });
});
