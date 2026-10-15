import {
  createFleetSchema,
  createInviteSchema,
  createRoleSchema,
  moveVehiclesSchema,
  PERMISSION_LABELS,
  PERMISSIONS,
  SYSTEM_ONLY_PERMISSIONS,
  updateFleetSchema,
  updateRoleSchema,
  updateUserSchema,
  vehicleListQuerySchema,
  type Fleet,
  type VehicleMeta,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  authorize,
  parse,
  requireFleetInScope,
  requireVehicleInScope,
  sessionUser,
} from '../context.ts';
import { atomic } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

type IdParams = { Params: { id: string } };

export async function accessRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { tree, sim, accounts, hub, drivers } = ctx;

  const fleetDto = (id: string): Fleet => tree.list([id]).find((f) => f.id === id)!;
  const requireFleetsExist = (ids: string[]) => {
    for (const id of ids)
      if (!tree.get(id)) throw new HttpError(422, 'validation_failed', `Unknown fleet ${id}`);
  };
  const requireRoleExists = (id: string) => {
    if (!accounts.roles.has(id))
      throw new HttpError(422, 'validation_failed', `Unknown role ${id}`);
  };

  /** F03-R14 (B8): only system roles may hold these; custom roles get 422 with a field issue. */
  const rejectSystemOnly = (permissions: readonly string[] | undefined) => {
    const blocked = SYSTEM_ONLY_PERMISSIONS.filter((p) => permissions?.includes(p));
    if (blocked.length === 0) return;
    const message = `${blocked.join(', ')} can only be granted to system roles`;
    throw new HttpError(422, 'validation_failed', message, [{ path: ['permissions'], message }]);
  };

  app.get('/permissions', async (req) => {
    sessionUser(ctx, req);
    return PERMISSIONS.map((id) => ({ id, label: PERMISSION_LABELS[id] }));
  });

  // ---- fleets ----

  app.get('/fleets', async (req) => tree.list(sessionUser(ctx, req).fleetIds));

  app.post('/fleets', async (req, reply) => {
    const { user } = authorize(ctx, req, 'fleets.manage');
    const body = parse(createFleetSchema, req.body);
    requireFleetInScope(ctx, body.parentId, user.fleetIds);
    const node = tree.create(body.parentId, body.name);
    return reply.code(201).send(fleetDto(node.id));
  });

  app.patch<IdParams>('/fleets/:id', async (req) => {
    const { user } = authorize(ctx, req, 'fleets.manage');
    const body = parse(updateFleetSchema, req.body);
    requireFleetInScope(ctx, req.params.id, user.fleetIds);
    if (body.parentId !== undefined) requireFleetInScope(ctx, body.parentId, user.fleetIds);
    tree.update(req.params.id, body);
    return fleetDto(req.params.id);
  });

  app.delete<IdParams>('/fleets/:id', async (req, reply) => {
    const { user } = authorize(ctx, req, 'fleets.manage');
    requireFleetInScope(ctx, req.params.id, user.fleetIds);
    tree.remove(req.params.id);
    return reply.code(204).send();
  });

  app.get('/vehicles', async (req) => {
    const query = parse(vehicleListQuerySchema, req.query);
    // F11: searching by driver name is a live-tracking feature, so `live.view` is enough for it.
    const { user } =
      query.driver === undefined
        ? authorize(ctx, req, 'fleets.manage')
        : authorize(ctx, req, 'fleets.manage', 'live.view');
    const driverQ = query.driver?.trim().toLowerCase();
    const only =
      query.fleetId === undefined ? -1 : requireFleetInScope(ctx, query.fleetId, user.fleetIds).idx;
    const mask = tree.scopeMask(user.fleetIds);
    const q = query.q?.trim().toLowerCase();
    const items: VehicleMeta[] = [];
    let i = query.cursor ? Number(query.cursor) : 0;
    if (!Number.isInteger(i) || i < 0)
      throw new HttpError(422, 'validation_failed', 'Invalid cursor');
    for (; i < sim.count && items.length < query.limit; i++) {
      const f = sim.fleet[i]!;
      if (!mask[f] || (only >= 0 && f !== only)) continue;
      if (driverQ) {
        const d = drivers.driverOf(i);
        if (d < 0 || !drivers.name(d).toLowerCase().includes(driverQ)) continue;
      }
      if (q) {
        const m = sim.meta(i);
        if (![m.vehicleId, m.regno, m.vin, m.deviceId].some((v) => v.toLowerCase().includes(q)))
          continue;
        items.push(m);
      } else items.push(sim.meta(i));
    }
    return { items, nextCursor: i < sim.count ? String(i) : null };
  });

  app.post<IdParams>('/fleets/:id/vehicles', async (req) => {
    const { user } = authorize(ctx, req, 'fleets.manage');
    const { vehicleIds } = parse(moveVehiclesSchema, req.body);
    const target = requireFleetInScope(ctx, req.params.id, user.fleetIds);
    const indices = vehicleIds.map((id) => requireVehicleInScope(ctx, id, user.fleetIds));
    let moved = 0;
    // One transaction for the whole batch (F22 §2); `moveTo` persists each move.
    atomic(ctx.db, () => {
      for (const i of indices) {
        if (sim.fleet[i] === target.idx) continue;
        hub.vehicleMoved(i, sim.fleet[i]!);
        sim.moveTo(i, target.idx);
        moved++;
      }
    });
    return { moved };
  });

  // ---- users ----

  app.get('/users', async (req) => {
    authorize(ctx, req, 'users.manage');
    return [...accounts.users.values()].map((u) => accounts.publicUser(u));
  });

  app.patch<IdParams>('/users/:id', async (req) => {
    const { user: me } = authorize(ctx, req, 'users.manage');
    const body = parse(updateUserSchema, req.body);
    const user = accounts.user(req.params.id);
    if (user.id === me.id && (body.roleId !== undefined || body.status !== undefined)) {
      throw new HttpError(409, 'conflict', 'You cannot change your own role or status');
    }
    if (body.roleId !== undefined) requireRoleExists(body.roleId);
    if (body.fleetIds) requireFleetsExist(body.fleetIds);
    return accounts.publicUser(accounts.updateUser(user.id, body));
  });

  // ---- invites ----

  app.get('/invites', async (req) => {
    authorize(ctx, req, 'users.invite');
    return [...accounts.invites.values()].map((i) => accounts.publicInvite(i));
  });

  app.post('/invites', async (req, reply) => {
    const { user } = authorize(ctx, req, 'users.invite');
    const body = parse(createInviteSchema, req.body);
    requireRoleExists(body.roleId);
    for (const id of body.fleetIds) requireFleetInScope(ctx, id, user.fleetIds);
    return reply.code(201).send(accounts.invite(body, user.id));
  });

  app.post<IdParams>('/invites/:id/resend', async (req) => {
    authorize(ctx, req, 'users.invite');
    return accounts.resend(req.params.id);
  });

  app.delete<IdParams>('/invites/:id', async (req, reply) => {
    authorize(ctx, req, 'users.invite');
    accounts.revoke(req.params.id);
    return reply.code(204).send();
  });

  // ---- roles ----

  app.get('/roles', async (req) => {
    authorize(ctx, req, 'roles.manage');
    return [...accounts.roles.values()];
  });

  app.post('/roles', async (req, reply) => {
    authorize(ctx, req, 'roles.manage');
    const body = parse(createRoleSchema, req.body);
    rejectSystemOnly(body.permissions);
    return reply
      .code(201)
      .send(accounts.addRole({ id: `role-${randomUUID()}`, system: false, ...body }));
  });

  app.patch<IdParams>('/roles/:id', async (req) => {
    authorize(ctx, req, 'roles.manage');
    const body = parse(updateRoleSchema, req.body);
    const role = accounts.role(req.params.id);
    if (role.system) throw new HttpError(409, 'conflict', 'System roles cannot be edited');
    rejectSystemOnly(body.permissions);
    return accounts.updateRole(role.id, body);
  });

  app.delete<IdParams>('/roles/:id', async (req, reply) => {
    authorize(ctx, req, 'roles.manage');
    accounts.deleteRole(req.params.id);
    return reply.code(204).send();
  });
}
