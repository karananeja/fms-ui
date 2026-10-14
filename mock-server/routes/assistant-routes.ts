import Anthropic from '@anthropic-ai/sdk';
import {
  chatRequestSchema,
  SESSION_COOKIE,
  type ChatEvent,
} from '@shared/contract/index.ts';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  assistantEnv,
  ASSISTANT_TIMEOUT_MS,
  FAKE_MODEL_PATH,
} from '../assistant/assistant-config.ts';
import { runChat } from '../assistant/assistant-runner.ts';
import { fakeScriptBodySchema, registerFakeModel } from '../assistant/fake-model.ts';
import { istDateOf, ReportStore } from '../assistant/reports.ts';
import { authorize, parse } from '../context.ts';
import { HttpError } from '../http-error.ts';

/**
 * F17 assistant (registered without a prefix):
 * - `POST /api/chat` (`chat.use`): SSE, one JSON `ChatEvent` per `data:` line.
 * - `GET /api/chat/reports/:id`: a generated report, only for the user who created it.
 * - Fake mode / dev: `POST /__fake-anthropic/v1/messages` (fake Messages API),
 *   `POST /api/dev/assistant/script`, `GET /api/dev/assistant/stats`, `DELETE /api/dev/assistant/script`.
 */
export async function assistantRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const reports = new ReportStore(() => ctx.clock.now());
  let activeRuns = 0;
  const fake =
    ctx.config.dev || process.env.FMS_ASSISTANT_FAKE === '1' ? registerFakeModel(app) : undefined;

  const ownBaseUrl = () => {
    const addr = app.server.address() as AddressInfo | null;
    return `http://127.0.0.1:${addr?.port ?? ctx.config.port}${FAKE_MODEL_PATH}`;
  };

  app.post('/api/chat', async (req, reply) => {
    const { user, permissions } = authorize(ctx, req, 'chat.use');
    const body = parse(chatRequestSchema, req.body);
    const sid = req.cookies[SESSION_COOKIE]!;
    const env = assistantEnv();

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const emit = (event: ChatEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    if (env.mode === 'not-configured' || (env.mode === 'fake' && !fake && !env.baseURL)) {
      emit({
        type: 'error',
        code: 'not_configured',
        message: 'The assistant is not set up yet. Ask an administrator to add an API key.',
      });
      res.end();
      return;
    }

    const controller = new AbortController();
    let abortReason: 'timeout' | 'client' | undefined;
    const timer = setTimeout(() => {
      abortReason = 'timeout';
      controller.abort();
    }, ASSISTANT_TIMEOUT_MS);
    res.on('close', () => {
      if (!res.writableEnded && !abortReason) {
        abortReason = 'client';
        controller.abort();
      }
    });

    const client = new Anthropic({
      apiKey: env.apiKey,
      baseURL: env.baseURL ?? (env.mode === 'fake' ? ownBaseUrl() : undefined),
      maxRetries: env.mode === 'fake' ? 0 : 2,
      timeout: ASSISTANT_TIMEOUT_MS,
    });
    const role = ctx.accounts.role(user.roleId).name;
    activeRuns++;
    try {
      await runChat({
        client,
        host: {
          ctx,
          user,
          permissions,
          reports,
          api: async (path) => {
            const r = await app.inject({ method: 'GET', url: path, cookies: { [SESSION_COOKIE]: sid } });
            return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as unknown) : null };
          },
          logError: (err) => app.log.error(err),
        },
        context: {
          name: user.name,
          role,
          fleets: user.fleetIds.map((id) => ctx.tree.get(id)?.name ?? id),
          today: istDateOf(ctx.clock.now()),
        },
        turns: body.messages,
        emit,
        signal: controller.signal,
        abortReason: () => abortReason,
        log: (msg, data) => app.log.info({ mode: env.mode, ...data }, msg),
      });
    } finally {
      activeRuns--;
      clearTimeout(timer);
      if (!res.writableEnded) res.end();
    }
  });

  app.get<{ Params: { id: string } }>('/api/chat/reports/:id', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const report = reports.get(req.params.id, user.id);
    if (!report)
      throw new HttpError(404, 'not_found', 'Report not found or expired. Ask again to regenerate.');
    const { filename } = report.descriptor;
    return reply
      .header('content-type', report.contentType)
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(typeof report.body === 'string' ? report.body : Buffer.from(report.body));
  });

  if (ctx.config.dev && fake) {
    app.post('/api/dev/assistant/script', async (req) =>
      fake.enqueue(parse(fakeScriptBodySchema, req.body)),
    );
    app.delete('/api/dev/assistant/script', async (_req, reply) => {
      fake.clear();
      return reply.code(204).send();
    });
    app.get('/api/dev/assistant/stats', async () => ({
      mode: assistantEnv().mode,
      activeRuns,
      reports: reports.size,
      fakeRequests: fake.stats.requests,
      fakeAborted: fake.stats.aborted,
    }));
    app.get('/api/dev/assistant/last-request', async () => fake.stats.lastRequest ?? null);
  }
}
