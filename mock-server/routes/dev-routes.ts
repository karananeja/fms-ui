import { setClockSchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { parse } from '../context.ts';

/** Dev-only helpers (registered only when `NODE_ENV !== 'production'`). */
export async function devRoutes(app: FastifyInstance) {
  const { accounts, clock, hub, sim } = app.mock;

  app.get<{ Querystring: { to?: string } }>('/mailbox', async (req) => {
    const to = req.query.to?.trim().toLowerCase();
    return accounts.mailbox.filter((m) => !to || m.to === to).slice(-20);
  });

  app.post('/clock', async (req) => {
    clock.offsetMs = parse(setClockSchema, req.body).offsetMs;
    return { offsetMs: clock.offsetMs, now: clock.now() };
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
