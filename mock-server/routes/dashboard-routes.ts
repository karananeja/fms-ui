import {
  addSharesBodySchema,
  createDashboardBodySchema,
  duplicateDashboardBodySchema,
  shareCandidateQuerySchema,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MIME_TYPES,
  snapshotQuerySchema,
  undoBodySchema,
  updateDashboardBodySchema,
  updatePreviewBodySchema,
  updateShareBodySchema,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { requireChatIdle } from '../assistant/dashboard-chat.ts';
import { authorize, parse } from '../context.ts';
import { HttpError } from '../http-error.ts';
import type { SnapshotMime } from '../store/dashboard-snapshots.ts';

type IdParams = { Params: { id: string } };
type ShareParams = { Params: { id: string; userId: string } };

/**
 * F18 §5: dashboards CRUD, sharing, thread read, undo and preview states (D-135). Every route
 * needs `dashboards.use`. F27: editors may PATCH, chat, undo their own change and read their
 * own thread; only the owner shares, changes access, revokes or deletes (see the F27 spec §3).
 */
export async function dashboardRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const { dashboards } = ctx;
  const auth = (req: Parameters<typeof authorize>[1]) => authorize(ctx, req, 'dashboards.use').user;
  /** `chat_busy` only for people who may edit (strangers still get 404 from the store). */
  const busyCheck = (userId: string, id: string) => {
    const access = dashboards.accessOf(userId, id);
    if (access === 'owner' || access === 'editor') requireChatIdle(ctx, id);
  };

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

  /** F27 (D-152): who changed what (any access; no chat content). */
  app.get<IdParams>('/dashboards/:id/activity', async (req) =>
    dashboards.activity(auth(req).id, req.params.id),
  );

  app.get<IdParams>('/dashboards/:id/shares', async (req) =>
    dashboards.shares(auth(req).id, req.params.id),
  );

  app.post<IdParams>('/dashboards/:id/shares', async (req) => {
    const user = auth(req);
    const { userIds, access } = parse(addSharesBodySchema, req.body);
    return dashboards.addShares(user.id, req.params.id, userIds, access);
  });

  /** F27 (D-150): change one person's level (owner only). */
  app.patch<ShareParams>('/dashboards/:id/shares/:userId', async (req) => {
    const user = auth(req);
    const { access } = parse(updateShareBodySchema, req.body);
    return dashboards.setShareAccess(user.id, req.params.id, req.params.userId, access);
  });

  app.delete<ShareParams>('/dashboards/:id/shares/:userId', async (req, reply) => {
    dashboards.revokeShare(auth(req).id, req.params.id, req.params.userId);
    return reply.code(204).send();
  });

  app.get<IdParams>('/dashboards/:id/thread', async (req) =>
    dashboards.thread(auth(req).id, req.params.id),
  );

  app.post<{ Params: { id: string; changeId: string } }>(
    '/dashboards/:id/changes/:changeId/undo',
    async (req) => {
      const user = auth(req);
      const { version } = parse(undoBodySchema, req.body);
      // F19 D-124: no undo while an assistant turn runs on this dashboard (F27: names who).
      busyCheck(user.id, req.params.id);
      return dashboards.undo(user.id, req.params.id, req.params.changeId, version);
    },
  );

  // ---- D-142: the caller's own list-card snapshot (raw image bodies, this scope only) ----
  app.addContentTypeParser(
    [...SNAPSHOT_MIME_TYPES],
    // Twice the cap so the store answers an over-size image with its own 413 message.
    { parseAs: 'buffer', bodyLimit: SNAPSHOT_MAX_BYTES * 2 },
    (_req, body, done) => done(null, body),
  );

  app.get<IdParams>('/dashboards/:id/snapshot', async (req, reply) => {
    const snap = dashboards.snapshot(auth(req).id, req.params.id);
    if (!snap) throw new HttpError(404, 'not_found', 'No snapshot yet');
    return reply
      .type(snap.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-snapshot-captured-at', String(snap.capturedAt))
      .header('x-snapshot-theme', snap.theme)
      .send(Buffer.from(snap.image));
  });

  app.put<IdParams & { Querystring: { theme?: string } }>(
    '/dashboards/:id/snapshot',
    async (req) => {
      const user = auth(req);
      const { theme } = parse(snapshotQuerySchema, req.query);
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(SNAPSHOT_MIME_TYPES as readonly string[]).includes(mime) || !Buffer.isBuffer(req.body))
        throw new HttpError(415, 'unsupported_media_type', 'Send an image/webp or image/png body');
      return dashboards.putSnapshot(
        user.id,
        req.params.id,
        mime as SnapshotMime,
        new Uint8Array(req.body),
        theme,
      );
    },
  );

  /** D-135: a chat preview card's state; the widget itself is added by the client's PATCH. */
  app.patch<{ Params: { id: string; previewId: string } }>(
    '/dashboards/:id/previews/:previewId',
    async (req) => {
      const user = auth(req);
      const { status } = parse(updatePreviewBodySchema, req.body);
      busyCheck(user.id, req.params.id);
      return dashboards.setPreviewStatus(user.id, req.params.id, req.params.previewId, status);
    },
  );
}
