import { setClockSchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { parse } from '../context.ts';
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
