import { createShareLinkSchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { MODELS } from '../generator/catalogue.ts';
import { authorize, parse, requireVehicleInScope } from '../context.ts';
import { HttpError } from '../http-error.ts';

export async function shareRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { shares, sim, tree, clock, hub } = ctx;

  app.post('/share-links', async (req, reply) => {
    const { user } = authorize(ctx, req, 'share.create');
    const body = parse(createShareLinkSchema, req.body);
    requireVehicleInScope(ctx, body.vehicleId, user.fleetIds);
    return reply.code(201).send(shares.create(body, user.id));
  });

  app.get<{ Querystring: { vehicleId?: string } }>('/share-links', async (req) => {
    const { user, permissions } = authorize(ctx, req, 'share.create', 'share.revoke');
    const seeAll = permissions.includes('share.revoke');
    const mask = tree.scopeMask(user.fleetIds);
    return [...shares.links.values()]
      .filter((l) => !req.query.vehicleId || l.vehicleId === req.query.vehicleId)
      .filter((l) => {
        if (!seeAll) return l.createdBy === user.id;
        const i = sim.indexOf(l.vehicleId);
        return i >= 0 && mask[sim.fleet[i]!] === 1;
      })
      .map((l) => shares.toDto(l));
  });

  app.delete<{ Params: { id: string } }>('/share-links/:id', async (req, reply) => {
    const { user, permissions } = authorize(ctx, req);
    const link = shares.get(req.params.id);
    const i = sim.indexOf(link.vehicleId);
    const canRevoke =
      link.createdBy === user.id ||
      (permissions.includes('share.revoke') &&
        i >= 0 &&
        tree.inScope(sim.fleetId(i), user.fleetIds));
    if (!canRevoke) throw new HttpError(403, 'forbidden', 'You cannot revoke this share link');
    shares.revoke(link);
    hub.closeShare(link.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>('/public/share/:token', async (req) => {
    const link = shares.open(req.params.token);
    const m = MODELS[sim.model[sim.indexOf(link.vehicleId)]!]!;
    return {
      vehicleId: link.vehicleId,
      vehicle: {
        regno: sim.regno(sim.indexOf(link.vehicleId)),
        make: m.make,
        model: m.model,
        variant: m.variant,
        fuelType: m.fuelType,
      },
      options: { show: link.show, trail: link.trail },
      expiresAt: link.expiresAt,
    };
  });

  app.get<{ Params: { token: string } }>('/public/share/:token/trail', async (req) => {
    const link = shares.open(req.params.token);
    if (!link.trail.enabled)
      throw new HttpError(404, 'not_found', 'Trail is disabled for this link');
    const now = clock.now();
    return {
      points: sim.trail(sim.indexOf(link.vehicleId), now - link.trail.windowMinutes * 60_000, now),
    };
  });
}
