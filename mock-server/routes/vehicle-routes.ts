import type { FastifyInstance } from 'fastify';
import { authorize, requireVehicleInScope } from '../context.ts';
import { noGpsInsight } from '../generator/no-gps-insight.ts';
import { HttpError } from '../http-error.ts';

const MAX_MINUTES = 24 * 60;

/** Selected-vehicle extras for the details panel (F07-R12). */
export async function vehicleRoutes(app: FastifyInstance) {
  const ctx = app.mock;

  app.get<{ Params: { id: string }; Querystring: { minutes?: string } }>(
    '/vehicles/:id/trail',
    async (req) => {
      const { user } = authorize(ctx, req, 'vehicle.details.view');
      const i = requireVehicleInScope(ctx, req.params.id, user.fleetIds);
      const minutes = Math.min(MAX_MINUTES, Math.max(1, Number(req.query.minutes) || 60));
      const now = ctx.clock.now();
      return { points: ctx.sim.trail(i, now - minutes * 60_000, now) };
    },
  );

  /** F11: likely cause of a vehicle's GPS loss; `404` if it is not in no-GPS. */
  app.get<{ Params: { id: string } }>('/vehicles/:id/no-gps-insight', async (req) => {
    const { user } = authorize(ctx, req, 'vehicle.details.view');
    const i = requireVehicleInScope(ctx, req.params.id, user.fleetIds);
    const reported = ctx.requests.openBreakdown(req.params.id)?.reason;
    const insight = noGpsInsight(ctx.sim, i, ctx.clock.now(), reported);
    if (!insight) throw new HttpError(404, 'not_found', 'Vehicle is not in no-GPS');
    return insight;
  });
}
