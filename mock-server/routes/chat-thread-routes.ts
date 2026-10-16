import { chatThreadListQuerySchema, renameChatThreadBodySchema } from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import { authorize, parse } from '../context.ts';

/**
 * F28 (D-163) saved Ask FMS conversations (prefix `/api`, `chat.use`). Only the caller's own
 * threads: another user's thread is 404 on every route. The turn itself is `POST /api/chat`.
 */
export async function chatThreadRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const threads = () => ctx.chatThreads;

  app.get('/chat/threads', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    return threads().list(user.id, parse(chatThreadListQuerySchema, req.query));
  });

  app.get<{ Params: { id: string } }>('/chat/threads/:id', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    return threads().get(user.id, req.params.id);
  });

  app.patch<{ Params: { id: string } }>('/chat/threads/:id', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    threads().summary(user.id, req.params.id);
    const { title } = parse(renameChatThreadBodySchema, req.body);
    return threads().rename(user.id, req.params.id, title);
  });

  app.delete<{ Params: { id: string } }>('/chat/threads/:id', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    threads().remove(user.id, req.params.id);
    // A running turn there is stopped (its reply has nowhere to go).
    threads().running.get(req.params.id)?.stop();
    return reply.code(204).send();
  });

  /**
   * D-155: the user's Stop. Aborts the running turn of the thread (stored as `stopped`) and
   * answers once it is saved (≤ 5 s); 204 also when nothing is running.
   */
  app.post<{ Params: { id: string } }>('/chat/threads/:id/stop', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    threads().summary(user.id, req.params.id);
    const run = threads().running.get(req.params.id);
    if (run && run.userId === user.id) {
      run.stop();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([run.done, new Promise<void>((r) => (timer = setTimeout(r, 5000)))]);
      clearTimeout(timer);
    }
    return reply.code(204).send();
  });
}
