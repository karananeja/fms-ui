import { actionKindSchema, setClockSchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, sessionUser } from '../context.ts';
import { resetStores } from '../db/seed.ts';

/** Dev-only helpers (registered only when `NODE_ENV !== 'production'`). */
export async function devRoutes(app: FastifyInstance) {
  const { accounts, clock, hub, sim, notifications } = app.mock;

  app.get<{ Querystring: { to?: string } }>('/mailbox', async (req) => {
    const to = req.query.to?.trim().toLowerCase();
    return accounts.mailbox.filter((m) => !to || m.to === to).slice(-20);
  });

  app.post('/clock', async (req) => {
    clock.offsetMs = parse(setClockSchema, req.body).offsetMs;
    // Clock-aware jobs (D-038) run at once instead of on their next minute tick.
    notifications.tick();
    return { offsetMs: clock.offsetMs, now: clock.now() };
  });

  /** Wipes the database (incl. dashboards) and re-seeds it; every session ends (F22 §7). */
  app.post('/reset', async (_req, reply) => {
    resetStores(app.mock);
    return reply.code(204).send();
  });

  /** F29 e2e: proposes an action as the signed-in user, like an assistant write tool would. */
  app.post('/actions/propose', async (req, reply) => {
    const user = sessionUser(app.mock, req);
    const body = parse(
      z.object({
        kind: actionKindSchema,
        params: z.record(z.string(), z.unknown()),
        threadId: z.string().nullable().optional(),
      }),
      req.body,
    );
    return reply.code(201).send(app.mock.actions.propose(user, body));
  });

  app.get('/stats', async () => {
    const cpu = process.cpuUsage();
    const mem = process.memoryUsage();
    return {
      vehicles: sim.count,
      sockets: hub.socketCount,
      subscriptions: hub.subscriptionCount,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      uptimeMs: Math.round(process.uptime() * 1000),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    };
  });
}
