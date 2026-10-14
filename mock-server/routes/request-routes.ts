import {
  createRequestSchema,
  requestActionBodySchema,
  requestListQuerySchema,
  updateFleetSettingsSchema,
  type DriverRequest,
  type Permission,
  type User,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { authorize, parse, requireFleetInScope, type MockContext } from '../context.ts';
import { HttpError } from '../http-error.ts';
import { requireSelfDriver } from './driver-routes.ts';

type IdParams = { Params: { id: string } };

/** `requests.manage` with the request's fleet in scope, or the requesting driver. */
function canSee(ctx: MockContext, user: User, perms: readonly Permission[], r: DriverRequest) {
  return (
    (perms.includes('requests.manage') && ctx.tree.inScope(r.fleetId, user.fleetIds)) ||
    (perms.includes('driver.self') &&
      ctx.drivers.byUserId(user.id) === ctx.drivers.indexOf(r.driverId))
  );
}

/** A request the caller may see (`404` otherwise, so ids of other fleets don't leak). */
function requireVisible(ctx: MockContext, user: User, perms: readonly Permission[], id: string) {
  const r = ctx.requests.get(id);
  if (!canSee(ctx, user, perms, r))
    throw new HttpError(404, 'not_found', `Request ${id} not found`);
  return r;
}

/** F11 driver requests (breakdown, replacement, RSA) and fleet settings. */
export async function requestRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { requests, tree } = ctx;

  app.post('/requests', async (req, reply) => {
    const { user } = authorize(ctx, req, 'driver.self');
    const body = parse(createRequestSchema, req.body);
    const d = requireSelfDriver(ctx, user);
    return reply.code(201).send(requests.create(d, body, user.id));
  });

  app.get('/requests', async (req) => {
    const { user, permissions } = authorize(ctx, req, 'requests.manage', 'driver.self');
    const query = parse(requestListQuerySchema, req.query);
    if (query.fleetId !== undefined) requireFleetInScope(ctx, query.fleetId, user.fleetIds);
    const all = requests.all;
    let k = query.cursor === undefined ? all.length - 1 : Number(query.cursor);
    if (!Number.isInteger(k) || k >= all.length)
      throw new HttpError(422, 'validation_failed', 'Invalid cursor');
    const items: DriverRequest[] = [];
    for (; k >= 0 && items.length < query.limit; k--) {
      const r = all[k]!;
      if (query.type && r.type !== query.type) continue;
      if (query.status && r.status !== query.status) continue;
      if (query.fleetId !== undefined && !tree.inScope(r.fleetId, [query.fleetId])) continue;
      if (canSee(ctx, user, permissions, r)) items.push(r);
    }
    return { items, nextCursor: k >= 0 ? String(k) : null };
  });

  app.get<IdParams>('/requests/:id', async (req) => {
    const { user, permissions } = authorize(ctx, req, 'requests.manage', 'driver.self');
    return requireVisible(ctx, user, permissions, req.params.id);
  });

  app.post<IdParams>('/requests/:id/actions', async (req) => {
    const { user } = authorize(ctx, req, 'requests.manage');
    const body = parse(requestActionBodySchema, req.body);
    const r = requireVisible(ctx, user, ['requests.manage'], req.params.id);
    return requests.act(r, body, user.id, user.fleetIds);
  });

  app.get<IdParams>('/requests/:id/suggestions', async (req) => {
    const { user } = authorize(ctx, req, 'requests.manage');
    return requests.suggestions(requireVisible(ctx, user, ['requests.manage'], req.params.id));
  });

  app.get<IdParams>('/fleets/:id/settings', async (req) => {
    const { user } = authorize(ctx, req, 'requests.manage', 'fleets.manage');
    return requests.settings(requireFleetInScope(ctx, req.params.id, user.fleetIds).idx);
  });

  app.patch<IdParams>('/fleets/:id/settings', async (req) => {
    const { user } = authorize(ctx, req, 'fleets.manage');
    const body = parse(updateFleetSettingsSchema, req.body);
    const fleet = requireFleetInScope(ctx, req.params.id, user.fleetIds);
    return requests.setAutoAssign(fleet.idx, body.autoAssignReplacement);
  });
}
