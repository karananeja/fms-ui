import Anthropic from '@anthropic-ai/sdk';
import {
  chatRequestSchema,
  dashboardChatRequestSchema,
  SESSION_COOKIE,
  type ChatEvent,
  type Permission,
  type User,
} from '@shared/contract/index.ts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  assistantEnv,
  ASSISTANT_TIMEOUT_MS,
  DASHBOARD_CHAT_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  FAKE_MODEL_PATH,
  FAKE_OPENAI_PATH,
  sseHeartbeatMs,
  xaiStreamUsage,
  type ProviderName,
} from '../assistant/assistant-config.ts';
import { AnthropicProvider } from '../assistant/anthropic-provider.ts';
import { OpenAiCompatibleProvider } from '../assistant/openai-provider.ts';
import type { ChatProvider, Usage } from '../assistant/provider.ts';
import {
  cacheLog,
  chatCacheKey,
  END_REASONS,
  runChat,
  type EndReason,
} from '../assistant/assistant-runner.ts';
import { runDashboardTurn, storedText, takeChatLock } from '../assistant/dashboard-chat.ts';
import { permittedWidgetTypes } from '../assistant/dashboard-tools.ts';
import type { UserContext } from '../assistant/system-prompt.ts';
import { fakeScriptBodySchema, registerFakeModel } from '../assistant/fake-model.ts';
import { istDateOf, ReportStore } from '../assistant/reports.ts';
import { authorize, parse } from '../context.ts';
import { HttpError } from '../http-error.ts';

/**
 * F17 assistant (registered without a prefix):
 * - `POST /api/chat` (`chat.use`): SSE, one JSON `ChatEvent` per `data:` line.
 * - `POST /api/dashboards/:id/chat` (`chat.use` + `dashboards.use`, owner only; F19): SSE,
 *   one turn of that dashboard's chat (409 `chat_busy` while another turn runs on it).
 * - `GET /api/chat/reports/:id`: a generated report, only for the user who created it.
 * - Fake mode / dev: `POST /__fake-anthropic/v1/messages` (fake Messages API),
 *   `POST /__fake-openai/v1/chat/completions` (fake chat-completions API, F21),
 *   `POST /api/dev/assistant/script`, `GET /api/dev/assistant/stats`, `DELETE /api/dev/assistant/script`.
 */
export async function assistantRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const reports = new ReportStore(() => ctx.clock.now());
  let activeRuns = 0;
  const fake =
    ctx.config.dev ||
    process.env.FMS_ASSISTANT_FAKE?.trim() === '1' ||
    process.env.FMS_ASSISTANT_PROVIDER?.trim().toLowerCase() === 'fake'
      ? registerFakeModel(app)
      : undefined;

  const ownBaseUrl = (path: string) => {
    const addr = app.server.address() as AddressInfo | null;
    return `http://127.0.0.1:${addr?.port ?? ctx.config.port}${path}`;
  };

  type Env = ReturnType<typeof assistantEnv>;
  /** Not-configured reasons already logged (one clear line each, not one per request). */
  const logged = new Set<string>();
  const unconfigured = (env: Env) => {
    const reason =
      env.mode === 'not-configured'
        ? (env.reason ?? 'not configured')
        : env.mode === 'fake' && !fake && !env.baseURL
          ? 'the fake model is not available (set FMS_ASSISTANT_FAKE=1 at startup)'
          : undefined;
    if (reason && !logged.has(reason)) {
      logged.add(reason);
      app.log.warn(`Assistant not configured: ${reason}. See README "AI assistant providers".`);
    }
    return reason !== undefined;
  };

  /**
   * Hijacks the reply into an SSE stream; `emit` writes one `ChatEvent` per `data:` line. F23:
   * a `: ping` comment line every 15 s keeps proxies and the browser from timing the stream out.
   */
  function openStream(reply: FastifyReply) {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const open = () => !res.writableEnded && !res.destroyed;
    const emit = (event: ChatEvent) => {
      if (open()) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (open()) res.write(': ping\n\n');
    }, sseHeartbeatMs());
    heartbeat.unref();
    res.on('close', () => clearInterval(heartbeat));
    res.on('finish', () => clearInterval(heartbeat));
    return { res, emit };
  }

  // ---- F24 cache stats and F23 stream end reasons (dev stats + one log line each) ----

  const cacheStats = new Map<
    ProviderName,
    { turns: number; inputTokens: number; cachedTokens: number }
  >();
  const onUsage = (provider: ProviderName, usage: Usage) => {
    const s = cacheStats.get(provider) ?? { turns: 0, inputTokens: 0, cachedTokens: 0 };
    const { inputTokens, cachedTokens } = cacheLog(usage);
    s.turns++;
    s.inputTokens += inputTokens;
    s.cachedTokens += cachedTokens;
    cacheStats.set(provider, s);
  };
  const streamEnds = Object.fromEntries(END_REASONS.map((r) => [r, 0])) as Record<
    EndReason,
    number
  >;
  const streamEnded = (chat: 'global' | 'dashboard', endReason: EndReason, started: number) => {
    streamEnds[endReason]++;
    app.log.info({ chat, endReason, ms: Date.now() - started }, 'assistant stream ended');
  };

  const NOT_CONFIGURED: ChatEvent = {
    type: 'error',
    code: 'not_configured',
    message: 'The assistant is not set up yet. Ask an administrator to add an API key.',
  };

  /** The provider of one run (F21, D-134): Anthropic SDK, or the OpenAI-compatible adapter. */
  function providerFor(env: Env, timeoutMs: number): ChatProvider {
    const isFake = env.mode === 'fake';
    const provider = env.provider ?? 'anthropic';
    if (provider === 'anthropic')
      return new AnthropicProvider(
        new Anthropic({
          apiKey: env.apiKey,
          baseURL: env.baseURL ?? (isFake ? ownBaseUrl(FAKE_MODEL_PATH) : undefined),
          maxRetries: isFake ? 0 : 2,
          timeout: timeoutMs,
        }),
        env.model,
      );
    return new OpenAiCompatibleProvider({
      name: provider,
      apiKey: env.apiKey ?? '',
      baseURL: env.baseURL ?? (isFake ? ownBaseUrl(FAKE_OPENAI_PATH) : DEFAULT_BASE_URL[provider]),
      model: env.model ?? '',
      maxRetries: isFake ? 0 : 2,
      // F24 (D-141): usage on streamed replies; unconfirmed for xAI, so it can be turned off.
      streamUsage: provider === 'openai' || xaiStreamUsage(),
    });
  }

  /** Timeout + client-close abort wiring and the provider for one run. */
  function runSetup(env: Env, res: FastifyReply['raw'], timeoutMs: number) {
    const controller = new AbortController();
    let abortReason: 'timeout' | 'client' | undefined;
    const timer = setTimeout(() => {
      abortReason = 'timeout';
      controller.abort();
    }, timeoutMs);
    res.on('close', () => {
      if (!res.writableEnded && !abortReason) {
        abortReason = 'client';
        controller.abort();
      }
    });
    return {
      provider: providerFor(env, timeoutMs),
      signal: controller.signal,
      abortReason: () => abortReason,
      clear: () => clearTimeout(timer),
    };
  }

  function hostFor(user: User, permissions: readonly Permission[], sid: string) {
    return {
      ctx,
      user,
      permissions,
      reports,
      api: async (path: string) => {
        const r = await app.inject({
          method: 'GET',
          url: path,
          cookies: { [SESSION_COOKIE]: sid },
        });
        return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as unknown) : null };
      },
      logError: (err: unknown) => app.log.error(err),
    };
  }

  const contextFor = (user: User, permissions: readonly Permission[]): UserContext => ({
    name: user.name,
    role: ctx.accounts.role(user.roleId).name,
    fleets: user.fleetIds.map((id) => ctx.tree.get(id)?.name ?? id),
    today: istDateOf(ctx.clock.now()),
    widgetTypes: permittedWidgetTypes(permissions),
  });

  app.post('/api/chat', async (req, reply) => {
    const { user, permissions } = authorize(ctx, req, 'chat.use');
    const body = parse(chatRequestSchema, req.body);
    const sid = req.cookies[SESSION_COOKIE]!;
    const env = assistantEnv();

    const started = Date.now();
    const { res, emit } = openStream(reply);
    if (unconfigured(env)) {
      emit(NOT_CONFIGURED);
      res.end();
      streamEnded('global', 'error', started);
      return;
    }

    const run = runSetup(env, res, ASSISTANT_TIMEOUT_MS);
    const question = body.messages.at(-1)!.content;
    let endReason: EndReason = 'error';
    activeRuns++;
    try {
      const outcome = await runChat({
        provider: run.provider,
        host: hostFor(user, permissions, sid),
        context: contextFor(user, permissions),
        turns: body.messages,
        emit,
        signal: run.signal,
        abortReason: run.abortReason,
        cacheKey: chatCacheKey(user.id, 'global'),
        onUsage,
        log: (msg, data) => app.log.info({ mode: env.mode, ...data }, msg),
        // F19 Q2: a dashboard created here gets the creating turn as its thread.
        onFinish: (outcome) => {
          for (const created of outcome.turn.created) {
            try {
              ctx.dashboards.appendMessage(user.id, created.id, { role: 'user', text: question });
              ctx.dashboards.appendMessage(user.id, created.id, {
                role: 'assistant',
                text: storedText(outcome),
                chips: [created.chip],
              });
            } catch (err) {
              app.log.error(err);
            }
          }
        },
      });
      endReason = outcome.endReason ?? 'error';
    } finally {
      activeRuns--;
      run.clear();
      if (!res.writableEnded) res.end();
      streamEnded('global', endReason, started);
    }
  });

  /** F19: the chat of one dashboard (owner only); the stored thread is the source of truth. */
  app.post<{ Params: { id: string } }>('/api/dashboards/:id/chat', async (req, reply) => {
    const { user, permissions } = authorize(ctx, req, 'chat.use');
    authorize(ctx, req, 'dashboards.use');
    const dashboardId = req.params.id;
    const dashboard = ctx.dashboards.get(user.id, dashboardId);
    if (dashboard.access !== 'owner')
      throw new HttpError(403, 'forbidden', 'Only the owner can chat with this dashboard');
    const { message } = parse(dashboardChatRequestSchema, req.body);
    const sid = req.cookies[SESSION_COOKIE]!;
    const env = assistantEnv();
    const started = Date.now();
    if (unconfigured(env)) {
      const { res, emit } = openStream(reply);
      emit(NOT_CONFIGURED);
      res.end();
      streamEnded('dashboard', 'error', started);
      return;
    }
    const release = takeChatLock(ctx, dashboardId);
    let run: ReturnType<typeof runSetup> | undefined;
    let res: FastifyReply['raw'] | undefined;
    let endReason: EndReason = 'error';
    activeRuns++;
    try {
      const stream = openStream(reply);
      res = stream.res;
      run = runSetup(env, res, DASHBOARD_CHAT_TIMEOUT_MS);
      const outcome = await runDashboardTurn({
        ctx,
        provider: run.provider,
        host: hostFor(user, permissions, sid),
        context: contextFor(user, permissions),
        dashboardId,
        text: message,
        emit: stream.emit,
        signal: run.signal,
        abortReason: run.abortReason,
        onUsage,
        log: (msg, data) => app.log.info({ mode: env.mode, dashboardId, ...data }, msg),
      });
      endReason = outcome.endReason ?? 'error';
    } catch (err) {
      app.log.error(err);
      if (res && !res.writableEnded)
        res.write(
          `data: ${JSON.stringify({ type: 'error', code: 'failed', message: 'Something went wrong. Try again.' } satisfies ChatEvent)}\n\n`,
        );
    } finally {
      activeRuns--;
      release();
      run?.clear();
      if (res && !res.writableEnded) res.end();
      if (res) streamEnded('dashboard', endReason, started);
    }
  });

  app.get<{ Params: { id: string } }>('/api/chat/reports/:id', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const report = reports.get(req.params.id, user.id);
    if (!report)
      throw new HttpError(
        404,
        'not_found',
        'Report not found or expired. Ask again to regenerate.',
      );
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
      provider: assistantEnv().provider ?? null,
      activeRuns,
      reports: reports.size,
      fakeRequests: fake.stats.requests,
      fakeAborted: fake.stats.aborted,
      // F24: cached / all input tokens per provider since start; F23: stream end reasons.
      cache: Object.fromEntries(
        [...cacheStats].map(([p, s]) => [
          p,
          {
            ...s,
            hitRate: s.inputTokens ? Math.round((s.cachedTokens / s.inputTokens) * 1000) / 1000 : 0,
          },
        ]),
      ),
      streamEnds,
    }));
    app.get('/api/dev/assistant/last-request', async () => fake.stats.lastRequest ?? null);
  }
}
