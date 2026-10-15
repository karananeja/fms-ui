import {
  addSharesBodySchema,
  createDashboardBodySchema,
  duplicateDashboardBodySchema,
  shareCandidateQuerySchema,
  undoBodySchema,
  updateDashboardBodySchema,
  updatePreviewBodySchema,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { chatBusy, isChatRunning } from '../assistant/dashboard-chat.ts';
import { authorize, parse } from '../context.ts';

type IdParams = { Params: { id: string } };

/** F18 §5: dashboards CRUD, sharing, thread read, undo and preview states (D-135). Every route needs `dashboards.use`. */
export async function dashboardRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { dashboards } = ctx;
  const auth = (req: Parameters<typeof authorize>[1]) => authorize(ctx, req, 'dashboards.use').user;

  app.get('/dashboards', async (req) => dashboards.list(auth(req).id));

  app.post('/dashboards', async (req, reply) => {
    const user = auth(req);
    const body = parse(createDashboardBodySchema, req.body);
    return reply.code(201).send(dashboards.create(user.id, body));
  });

  app.get<{ Querystring: { q?: string } }>('/dashboards/share-candidates', async (req) => {
    const user = auth(req);
    const { q } = parse(shareCandidateQuerySchema, req.query);
    return dashboards.shareCandidates(user, q);
  });

  app.get<IdParams>('/dashboards/:id', async (req) => dashboards.get(auth(req).id, req.params.id));

  app.patch<IdParams>('/dashboards/:id', async (req) => {
    const user = auth(req);
    const body = parse(updateDashboardBodySchema, req.body);
    return dashboards.update(user.id, req.params.id, body);
  });

  app.post<IdParams>('/dashboards/:id/duplicate', async (req, reply) => {
    const user = auth(req);
    const { title } = parse(duplicateDashboardBodySchema, req.body);
    return reply.code(201).send(dashboards.duplicate(user.id, req.params.id, title));
  });

  app.delete<IdParams>('/dashboards/:id', async (req, reply) => {
    dashboards.remove(auth(req).id, req.params.id);
    return reply.code(204).send();
  });

  app.get<IdParams>('/dashboards/:id/shares', async (req) =>
    dashboards.shares(auth(req).id, req.params.id),
  );

  app.post<IdParams>('/dashboards/:id/shares', async (req) => {
    const user = auth(req);
    const { userIds } = parse(addSharesBodySchema, req.body);
    return dashboards.addShares(user.id, req.params.id, userIds);
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    '/dashboards/:id/shares/:userId',
    async (req, reply) => {
      dashboards.revokeShare(auth(req).id, req.params.id, req.params.userId);
      return reply.code(204).send();
    },
  );

  app.get<IdParams>('/dashboards/:id/thread', async (req) =>
    dashboards.thread(auth(req).id, req.params.id),
  );

  app.post<{ Params: { id: string; changeId: string } }>(
    '/dashboards/:id/changes/:changeId/undo',
    async (req) => {
      const user = auth(req);
      const { version } = parse(undoBodySchema, req.body);
      // F19 D-124: no undo while an assistant turn runs on this dashboard.
      if (isChatRunning(ctx, req.params.id)) throw chatBusy();
      return dashboards.undo(user.id, req.params.id, req.params.changeId, version);
    },
  );

  /** D-135: a chat preview card's state; the widget itself is added by the client's PATCH. */
  app.patch<{ Params: { id: string; previewId: string } }>(
    '/dashboards/:id/previews/:previewId',
    async (req) => {
      const user = auth(req);
      const { status } = parse(updatePreviewBodySchema, req.body);
      if (isChatRunning(ctx, req.params.id)) throw chatBusy();
      return dashboards.setPreviewStatus(user.id, req.params.id, req.params.previewId, status);
    },
  );
}
