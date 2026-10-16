import { SESSION_COOKIE, type Permission } from '@shared/contract/index.ts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import type { Clock } from './clock.ts';
import type { MockConfig } from './config.ts';
import type { FleetTree } from './generator/fleet-tree.ts';
import type { HistorySim } from './generator/history-sim.ts';
import type { VehicleSim } from './generator/vehicle-sim.ts';
import { HttpError } from './http-error.ts';
import type { LiveHub } from './live/live-hub.ts';
import { SESSION_TTL_MS, type Accounts } from './store/accounts.ts';
import type { AiKeys } from './store/ai-keys.ts';
import type { AssistantActions } from './store/assistant-actions.ts';
import type { ChatThreads } from './store/chat-threads.ts';
import type { Dashboards } from './store/dashboards.ts';
import type { Drivers } from './store/drivers.ts';
import type { Notifications } from './store/notifications.ts';
import type { Requests } from './store/requests.ts';
import type { ShareLinks } from './store/share-links.ts';
import type { AiUsage } from './store/usage.ts';

export interface MockContext {
  config: MockConfig;
  clock: Clock;
  tree: FleetTree;
  sim: VehicleSim;
  accounts: Accounts;
  shares: ShareLinks;
  hub: LiveHub;
  drivers: Drivers;
  history: HistorySim;
  requests: Requests;
  notifications: Notifications;
  db: DatabaseSync;
  dashboards: Dashboards;
  /** F25 user AI keys, org settings, audit log. */
  aiKeys: AiKeys;
  /** F28 saved Ask FMS conversations. */
  chatThreads: ChatThreads;
  /** F30 AI token usage (one row per model run). */
  usage: AiUsage;
  /** F29 assistant actions (propose / confirm / undo) and the audit log. */
  actions: AssistantActions;
}

declare module 'fastify' {
  interface FastifyInstance {
    mock: MockContext;
  }
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new HttpError(
      422,
      'validation_failed',
      result.error.issues[0]?.message ?? 'Invalid request',
      result.error.issues,
    );
  }
  return result.data;
}

export function setSessionCookie(reply: FastifyReply, sid: string): void {
  reply.setCookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function sessionUser(ctx: MockContext, req: FastifyRequest) {
  const user = ctx.accounts.touchSession(req.cookies[SESSION_COOKIE]);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  return user;
}

/** The signed-in user, or `401`; with `perms`, also requires at least one of them, or `403`. */
export function authorize(ctx: MockContext, req: FastifyRequest, ...perms: Permission[]) {
  const user = sessionUser(ctx, req);
  const granted = ctx.accounts.permissions(user);
  if (perms.length && !perms.some((p) => granted.includes(p))) {
    throw new HttpError(403, 'forbidden', `Requires permission ${perms.join(' or ')}`);
  }
  return { user, permissions: granted };
}

/** `403` unless the fleet lies in one of the user's granted subtrees (`404` if it does not exist). */
export function requireFleetInScope(ctx: MockContext, fleetId: string, scope: readonly string[]) {
  const node = ctx.tree.require(fleetId);
  if (!ctx.tree.inScope(fleetId, scope))
    throw new HttpError(403, 'forbidden', 'Fleet is outside your scope');
  return node;
}

/** Vehicle index by id: `404` if unknown, `403` if outside the user's fleets. */
export function requireVehicleInScope(
  ctx: MockContext,
  vehicleId: string,
  scope: readonly string[],
) {
  const i = ctx.sim.indexOf(vehicleId);
  if (i < 0) throw new HttpError(404, 'not_found', `Vehicle ${vehicleId} not found`);
  if (!ctx.tree.inScope(ctx.sim.fleetId(i), scope)) {
    throw new HttpError(403, 'forbidden', 'Vehicle is outside your scope');
  }
  return i;
}
