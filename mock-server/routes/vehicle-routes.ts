import type { FastifyInstance } from 'fastify';
import { authorize, requireVehicleInScope } from '../context.ts';

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
}
