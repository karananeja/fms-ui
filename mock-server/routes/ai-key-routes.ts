import {
  aiProviderSchema,
  assistantChoiceInputSchema,
  enableAiModelsSchema,
  KEY_CHECK_LIMIT,
  KEY_CHECK_WINDOW_MS,
  saveAiKeySchema,
  updateAiSettingsSchema,
  type AiKeysState,
  type AiProvider,
} from '@shared/contract/index.ts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { fakeModelAvailable } from '../assistant/assistant-config.ts';
import { secretKey } from '../assistant/key-crypto.ts';
import { KeyCheckError, listModels } from '../assistant/provider-models.ts';
import { aiSettingsOf, resolveForUser, statusOf } from '../assistant/user-assistant.ts';
import { authorize, parse } from '../context.ts';
import { HttpError } from '../http-error.ts';

/**
 * F25 (D-143) + F31 (D-171), prefix `/api`:
 * - `GET /me/ai-keys`, `PUT|DELETE /me/ai-keys/:provider` (Save checks the key and loads its
 *   models), `POST /me/ai-keys/:provider/models/refresh`, `PUT /me/ai-keys/:provider/models`
 *   (enabled models), `PUT /me/ai-model` (the chat picker's choice). All `chat.use`; Save and
 *   Refresh share a rate limit.
 * - `GET /assistant/status` (`chat.use`): the chat header picker.
 * - `GET|PUT /settings/ai` (`roles.manage`): the server-key fallback switch.
 * Keys are never logged or returned; provider failures map to fixed messages.
 */
export async function aiKeyRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const fakeAvailable = () => fakeModelAvailable(ctx.config.dev);
  const status = (userId: string) =>
    statusOf(ctx, userId, resolveForUser(ctx, userId, fakeAvailable()));

  const stateFor = (userId: string, notice?: string): AiKeysState => ({
    keys: ctx.aiKeys.list(userId),
    status: status(userId),
    fallback: {
      allowed: ctx.aiKeys.allowServerKeyFallback,
      serverConfigured: aiSettingsOf(ctx).serverConfigured,
    },
    storageAvailable: secretKey() !== undefined,
    ...(notice ? { notice } : {}),
  });

  /** Sliding-window limit on key checks per user (memory only). */
  const checks = new Map<string, number[]>();
  const rateLimit = (userId: string, reply: FastifyReply) => {
    const now = ctx.clock.now();
    const recent = (checks.get(userId) ?? []).filter((t) => now - t < KEY_CHECK_WINDOW_MS);
    if (recent.length >= KEY_CHECK_LIMIT) {
      const retry = Math.max(1, Math.ceil((recent[0]! + KEY_CHECK_WINDOW_MS - now) / 1000));
      checks.set(userId, recent);
      reply.header('retry-after', String(retry));
      throw new HttpError(429, 'rate_limited', `Too many key checks. Try again in ${retry} s.`);
    }
    recent.push(now);
    checks.set(userId, recent);
  };

  const providerParam = (raw: string): AiProvider => {
    const p = aiProviderSchema.safeParse(raw);
    if (!p.success) throw new HttpError(404, 'not_found', `Unknown provider ${raw}`);
    return p.data;
  };

  const logCheckFailure = (provider: AiProvider, err: KeyCheckError) =>
    app.log.warn({ provider, kind: err.kind, status: err.status }, 'AI key check failed');

  /** The key's models; a rejected key is a 422, other failures `undefined` or a 502. */
  const loadModels = async (provider: AiProvider, apiKey: string, soft: boolean) => {
    try {
      return await listModels(provider, apiKey, { fakeAvailable: fakeAvailable() });
    } catch (err) {
      if (!(err instanceof KeyCheckError)) throw err;
      logCheckFailure(provider, err);
      if (err.kind !== 'rejected' && soft) return undefined;
      throw new HttpError(err.kind === 'rejected' ? 422 : 502, `key_${err.kind}`, err.message);
    }
  };

  app.get('/me/ai-keys', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    return stateFor(user.id);
  });

  app.put<{ Params: { provider: string } }>('/me/ai-keys/:provider', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const provider = providerParam(req.params.provider);
    const body = parse(saveAiKeySchema, req.body);
    if (!secretKey())
      throw new HttpError(
        409,
        'secret_missing',
        'The server has no FMS_SECRET_KEY, so API keys cannot be stored. Ask an administrator.',
      );
    rateLimit(user.id, reply);
    const models = await loadModels(provider, body.apiKey, true);
    ctx.aiKeys.save(user.id, provider, { apiKey: body.apiKey, models }, user.id);
    app.log.info({ userId: user.id, provider, models: models?.length ?? null }, 'AI key saved');
    return stateFor(user.id, models ? undefined : "Saved. Couldn't load models: try Refresh.");
  });

  app.post<{ Params: { provider: string } }>(
    '/me/ai-keys/:provider/models/refresh',
    async (req, reply) => {
      const { user } = authorize(ctx, req, 'chat.use');
      const provider = providerParam(req.params.provider);
      const apiKey = ctx.aiKeys.storedKey(user.id, provider);
      if (!apiKey)
        throw new HttpError(
          404,
          'not_found',
          ctx.aiKeys.has(user.id, provider)
            ? 'The saved key cannot be read. Paste it again.'
            : 'No saved key for this provider',
        );
      rateLimit(user.id, reply);
      const models = (await loadModels(provider, apiKey, false))!;
      ctx.aiKeys.refreshModels(user.id, provider, models);
      return stateFor(user.id);
    },
  );

  app.put<{ Params: { provider: string } }>('/me/ai-keys/:provider/models', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const provider = providerParam(req.params.provider);
    const body = parse(enableAiModelsSchema, req.body);
    ctx.aiKeys.setEnabled(user.id, provider, body.enabled, user.id);
    return stateFor(user.id);
  });

  app.put('/me/ai-model', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const body = parse(assistantChoiceInputSchema, req.body);
    if ('source' in body) {
      if (!status(user.id).serverOption)
        throw new HttpError(
          409,
          'fallback_disabled',
          'The default assistant is not available. Choose one of your models.',
        );
      ctx.aiKeys.choose(user.id, 'server');
    } else ctx.aiKeys.choose(user.id, body);
    return status(user.id);
  });

  app.delete<{ Params: { provider: string } }>('/me/ai-keys/:provider', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const provider = providerParam(req.params.provider);
    ctx.aiKeys.remove(user.id, provider, user.id);
    app.log.info({ userId: user.id, provider }, 'AI key removed');
    return stateFor(user.id);
  });

  app.get('/assistant/status', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    return status(user.id);
  });

  app.get('/settings/ai', async (req) => {
    authorize(ctx, req, 'roles.manage');
    return aiSettingsOf(ctx);
  });

  app.put('/settings/ai', async (req) => {
    const { user } = authorize(ctx, req, 'roles.manage');
    const body = parse(updateAiSettingsSchema, req.body);
    ctx.aiKeys.setAllowServerKeyFallback(body.allowServerKeyFallback, user.id);
    return aiSettingsOf(ctx);
  });
}
