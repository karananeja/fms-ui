import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { SESSION_COOKIE, WS_CLOSE, WS_PATH } from '@shared/contract/index.ts';
import Fastify, { LogController, type FastifyError } from 'fastify';
import { Clock } from './clock.ts';
import { loadConfig, type MockConfig } from './config.ts';
import { setSessionCookie, type MockContext } from './context.ts';
import { FleetTree } from './generator/fleet-tree.ts';
import { VehicleSim } from './generator/vehicle-sim.ts';
import { HttpError } from './http-error.ts';
import { LiveHub } from './live/live-hub.ts';
import { accessRoutes } from './routes/access-routes.ts';
import { authRoutes } from './routes/auth-routes.ts';
import { devRoutes } from './routes/dev-routes.ts';
import { shareRoutes } from './routes/share-routes.ts';
import { vehicleRoutes } from './routes/vehicle-routes.ts';
import { Accounts } from './store/accounts.ts';
import { ShareLinks } from './store/share-links.ts';

export interface BuildOptions extends Partial<MockConfig> {
  logLevel?: string;
}

export function buildServer({ logLevel = 'warn', ...overrides }: BuildOptions = {}) {
  const config: MockConfig = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: logLevel },
    logController: new LogController({ disableRequestLogging: true }),
  });

  const clock = new Clock();
  const tree = new FleetTree();
  const sim = new VehicleSim(config.seed, config.vehicles, config.vehicleIntervalMs, tree);
  const ctx = { config, clock, tree, sim } as MockContext;
  ctx.accounts = new Accounts(clock, tree, (mail) =>
    app.log.info(`[mail] to ${mail.to}: ${mail.subject} → ${mail.url}`),
  );
  ctx.shares = new ShareLinks(clock);
  ctx.hub = new LiveHub(ctx);
  app.decorate('mock', ctx);

  app.register(cookie);
  app.register(websocket);

  app.addHook('onRequest', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid && ctx.accounts.touchSession(sid) && !req.url.startsWith('/api/auth/logout')) {
      setSessionCookie(reply, sid);
    }
  });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof HttpError) {
      const details = err.details === undefined ? {} : { details: err.details };
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.message, ...details } });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) app.log.error(err);
    return reply
      .code(status)
      .send({ error: { code: status === 500 ? 'internal' : 'bad_request', message: err.message } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'not_found', message: `${req.method} ${req.url} not found` } }),
  );

  app.get('/api/health', async () => ({ ok: true }));
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(accessRoutes, { prefix: '/api' });
  app.register(shareRoutes, { prefix: '/api' });
  app.register(vehicleRoutes, { prefix: '/api' });
  if (config.dev) app.register(devRoutes, { prefix: '/api/dev' });

  app.register(async (scope) => {
    scope.get<{ Querystring: { share?: string } }>(WS_PATH, { websocket: true }, (socket, req) => {
      const shareToken = req.query.share;
      if (shareToken !== undefined) {
        const link = ctx.shares.byToken(shareToken);
        if (!link)
          return ctx.hub.accept(socket, {
            close: WS_CLOSE.unauthenticated,
            reason: 'unknown share link',
          });
        if (!ctx.shares.isLive(link))
          return ctx.hub.accept(socket, { close: WS_CLOSE.gone, reason: 'share link expired' });
        return ctx.hub.accept(socket, { kind: 'share', link });
      }
      const user = ctx.accounts.touchSession(req.cookies[SESSION_COOKIE]);
      if (!user)
        return ctx.hub.accept(socket, {
          close: WS_CLOSE.unauthenticated,
          reason: 'sign in required',
        });
      ctx.hub.accept(socket, { kind: 'user', userId: user.id });
    });
  });

  app.addHook('onReady', async () => ctx.hub.start());
  app.addHook('onClose', async () => ctx.hub.stop());
  return app;
}
