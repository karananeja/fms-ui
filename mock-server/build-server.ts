import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { SESSION_COOKIE, WS_CLOSE, WS_PATH } from '@shared/contract/index.ts';
import Fastify, { LogController, type FastifyError } from 'fastify';
import { Clock } from './clock.ts';
import { loadConfig, type MockConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { setSessionCookie, type MockContext } from './context.ts';
import { FleetTree } from './generator/fleet-tree.ts';
import { HistorySim } from './generator/history-sim.ts';
import { VehicleSim } from './generator/vehicle-sim.ts';
import { HttpError } from './http-error.ts';
import { LiveHub } from './live/live-hub.ts';
import { accessRoutes } from './routes/access-routes.ts';
import { analyticsRoutes } from './routes/analytics-routes.ts';
import { assistantRoutes } from './routes/assistant-routes.ts';
import { authRoutes } from './routes/auth-routes.ts';
import { dashboardRoutes } from './routes/dashboard-routes.ts';
import { devRoutes } from './routes/dev-routes.ts';
import { driverRoutes } from './routes/driver-routes.ts';
import { notificationRoutes } from './routes/notification-routes.ts';
import { requestRoutes } from './routes/request-routes.ts';
import { shareRoutes } from './routes/share-routes.ts';
import { vehicleRoutes } from './routes/vehicle-routes.ts';
import { Accounts, DRIVER_USER_ID } from './store/accounts.ts';
import { Dashboards } from './store/dashboards.ts';
import { Drivers } from './store/drivers.ts';
import { Notifications } from './store/notifications.ts';
import { Requests } from './store/requests.ts';
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
  ctx.drivers = new Drivers(config.seed, sim, tree, clock);
  ctx.history = new HistorySim(sim);
  ctx.requests = new Requests(ctx);
  ctx.notifications = new Notifications(ctx);
  ctx.hub = new LiveHub(ctx);
  const dbStarted = performance.now();
  ctx.db = openDatabase(config.dbPath, undefined, () => clock.now());
  ctx.dashboards = new Dashboards(ctx.db, clock, ctx.accounts, tree);
  app.log.debug(
    `database ${config.dbPath} ready in ${(performance.now() - dbStarted).toFixed(1)} ms`,
  );
  ctx.drivers.onAssignment = (a) => {
    const i = sim.indexOf(a.vehicleId);
    ctx.hub.publish('assignment', a, {
      fleetId: sim.fleetId(i),
      staff: ['drivers.manage', 'vehicle.details.view'],
      driver: ctx.drivers.indexOf(a.driverId),
    });
    ctx.requests.reevaluate();
  };
  linkSeedDriver(ctx);
  ctx.notifications.tick();
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
  app.register(driverRoutes, { prefix: '/api' });
  app.register(requestRoutes, { prefix: '/api' });
  app.register(notificationRoutes, { prefix: '/api' });
  app.register(analyticsRoutes, { prefix: '/api' });
  app.register(dashboardRoutes, { prefix: '/api' });
  app.register(assistantRoutes);
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

  app.addHook('onReady', async () => {
    ctx.hub.start();
    ctx.notifications.start();
  });
  app.addHook('onClose', async () => {
    ctx.hub.stop();
    ctx.notifications.stop();
    if (ctx.db.isOpen) ctx.db.close();
  });
  return app;
}

/** Links `driver@fms.local` to the first driver in North that has a vehicle (F11 §6). */
function linkSeedDriver(ctx: MockContext): void {
  const { drivers, tree, accounts } = ctx;
  const north = [...tree.byId.values()].find((f) => f.name === 'North');
  if (!north) return;
  for (let d = 0; d < drivers.gen.assignedCount; d++) {
    if (!tree.isDescendant(drivers.fleetIdx(d), north.idx)) continue;
    drivers.linkUser(d, DRIVER_USER_ID);
    accounts.user(DRIVER_USER_ID).name = drivers.name(d);
    return;
  }
}
