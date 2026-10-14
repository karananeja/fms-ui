import {
  markNotificationsReadSchema,
  notificationListQuerySchema,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { authorize, parse } from '../context.ts';

/** F11 notifications feed: only what the caller may see (F11 §3 visibility), with read state. */
export async function notificationRoutes(app: FastifyInstance) {
  const ctx = app.mock;

  app.get('/notifications', async (req) => {
    const { user, permissions } = authorize(ctx, req);
    const query = parse(notificationListQuerySchema, req.query);
    return ctx.notifications.list(user, permissions, query);
  });

  app.post('/notifications/read', async (req) => {
    const { user, permissions } = authorize(ctx, req);
    const body = parse(markNotificationsReadSchema, req.body);
    return ctx.notifications.markRead(user, permissions, body);
  });
}
