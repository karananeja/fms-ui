import {
  assignmentQuerySchema,
  createDriverSchema,
  driverListQuerySchema,
  setAssignmentSchema,
  updateDriverSchema,
  type Driver,
  type DriverMe,
  type User,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import {
  authorize,
  parse,
  requireFleetInScope,
  requireVehicleInScope,
  type MockContext,
} from '../context.ts';
import { HttpError } from '../http-error.ts';
import { DRIVER_ROLE } from '../store/accounts.ts';

type IdParams = { Params: { id: string } };

/** Driver index by id, `404` if unknown, `403` if the driver's fleet is outside `scope`. */
export function requireDriverInScope(ctx: MockContext, id: string, scope: readonly string[]) {
  const d = ctx.drivers.require(id);
  if (!ctx.tree.inScope(ctx.drivers.fleetId(d), scope))
    throw new HttpError(403, 'forbidden', 'Driver is outside your scope');
  return d;
}

/** The driver linked to the signed-in user (`404` if none). */
export function requireSelfDriver(ctx: MockContext, user: User) {
  const d = ctx.drivers.byUserId(user.id);
  if (d < 0) throw new HttpError(404, 'not_found', 'No driver is linked to your account');
  return d;
}

/** F11 drivers, assignments and the driver's own page data. */
export async function driverRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { drivers, tree, sim, accounts, requests, clock } = ctx;
  /** Invites sent by `POST /drivers`, by invite id → driver index. */
  const invited = new Map<string, number>();
  accounts.onInviteAccepted.push((inviteId, userId) => {
    const d = invited.get(inviteId);
    if (d !== undefined) drivers.linkUser(d, userId);
  });

  app.get('/drivers', async (req) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    const query = parse(driverListQuerySchema, req.query);
    const mask = tree.scopeMask(
      query.fleetId === undefined
        ? user.fleetIds
        : [requireFleetInScope(ctx, query.fleetId, user.fleetIds).id],
    );
    const q = query.q?.trim().toLowerCase();
    const items: Driver[] = [];
    let d = query.cursor ? Number(query.cursor) : 0;
    if (!Number.isInteger(d) || d < 0)
      throw new HttpError(422, 'validation_failed', 'Invalid cursor');
    for (; d < drivers.count && items.length < query.limit; d++) {
      if (!mask[drivers.fleetIdx(d)]) continue;
      if (query.status && drivers.status(d) !== query.status) continue;
      if (
        q &&
        !drivers.name(d).toLowerCase().includes(q) &&
        !drivers.phone(d).replace(/\s/g, '').includes(q.replace(/\s/g, ''))
      )
        continue;
      items.push(drivers.get(d));
    }
    return { items, nextCursor: d < drivers.count ? String(d) : null };
  });

  app.post('/drivers', async (req, reply) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    const body = parse(createDriverSchema, req.body);
    const fleet = requireFleetInScope(ctx, body.fleetId, user.fleetIds);
    const d = drivers.create({
      name: body.name,
      phone: body.phone,
      fleetIdx: fleet.idx,
      status: body.status,
    });
    if (body.invite) {
      const invite = accounts.invite(
        { email: body.email!, roleId: DRIVER_ROLE, fleetIds: [fleet.id] },
        user.id,
      );
      invited.set(invite.id, d);
    }
    return reply.code(201).send(drivers.get(d));
  });

  app.get<IdParams>('/drivers/:id', async (req) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    return drivers.get(requireDriverInScope(ctx, req.params.id, user.fleetIds));
  });

  app.patch<IdParams>('/drivers/:id', async (req) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    const body = parse(updateDriverSchema, req.body);
    const d = requireDriverInScope(ctx, req.params.id, user.fleetIds);
    const fleetIdx =
      body.fleetId === undefined
        ? undefined
        : requireFleetInScope(ctx, body.fleetId, user.fleetIds).idx;
    drivers.update(d, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(fleetIdx === undefined ? {} : { fleetIdx }),
    });
    return drivers.get(d);
  });

  app.put<IdParams>('/drivers/:id/assignment', async (req) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    const { vehicleId } = parse(setAssignmentSchema, req.body);
    const d = requireDriverInScope(ctx, req.params.id, user.fleetIds);
    const i = requireVehicleInScope(ctx, vehicleId, user.fleetIds);
    return drivers.assign(d, i, user.id);
  });

  app.delete<IdParams>('/drivers/:id/assignment', async (req, reply) => {
    const { user } = authorize(ctx, req, 'drivers.manage');
    drivers.unassign(requireDriverInScope(ctx, req.params.id, user.fleetIds));
    return reply.code(204).send();
  });

  app.get('/assignments', async (req) => {
    const { user } = authorize(ctx, req, 'drivers.manage', 'vehicle.details.view');
    const query = parse(assignmentQuerySchema, req.query);
    let list =
      query.driverId !== undefined
        ? drivers.driverHistory(requireDriverInScope(ctx, query.driverId, user.fleetIds))
        : drivers.vehicleHistory(requireVehicleInScope(ctx, query.vehicleId!, user.fleetIds));
    if (query.driverId !== undefined && query.vehicleId !== undefined)
      list = list.filter((a) => a.vehicleId === query.vehicleId);
    return list.reverse();
  });

  app.get<IdParams>('/vehicles/:id/driver', async (req) => {
    const { user } = authorize(ctx, req, 'vehicle.details.view');
    const d = drivers.driverOf(requireVehicleInScope(ctx, req.params.id, user.fleetIds));
    return d < 0 ? null : drivers.get(d);
  });

  app.get('/driver/me', async (req): Promise<DriverMe> => {
    const { user } = authorize(ctx, req, 'driver.self');
    const d = requireSelfDriver(ctx, user);
    const i = drivers.vehicleOf(d);
    let vehicle: DriverMe['vehicle'] = null;
    if (i >= 0) {
      const s = sim.state(i, clock.now());
      vehicle = {
        meta: sim.meta(i),
        live: {
          lat: s.lat,
          lng: s.lng,
          speed: s.speed,
          heading: s.heading,
          ignstatus: s.ignstatus,
          carbattery: s.carbattery,
          devbattery: s.devbattery,
          fixquality: s.fixquality,
          utctime: s.utctime,
          gpstime: s.gpstime,
          canutctime: s.canutctime,
          soc: s.soc,
          dte: s.dte,
          odometer: s.odometer,
          immobilization_status: s.immobilization_status,
          charging: s.charging,
        },
      };
    }
    return {
      driver: drivers.get(d),
      vehicle,
      openRequests: requests.openForDriver(drivers.gen.id(d)),
    };
  });
}
