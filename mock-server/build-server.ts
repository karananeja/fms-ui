import Fastify from 'fastify';

export function buildServer() {
  const app = Fastify({ logger: { level: 'warn' } });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
