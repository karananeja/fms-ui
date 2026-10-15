import {
  aiKeyTestRequestSchema,
  aiModelsRequestSchema,
  aiProviderSchema,
  KEY_CHECK_LIMIT,
  KEY_CHECK_WINDOW_MS,
  saveAiKeySchema,
  updateAiSettingsSchema,
  type AiKeysState,
  type AiKeyTestResult,
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
 * F25 (D-143), prefix `/api`:
 * - `GET /me/ai-keys`, `POST /me/ai-keys/models`, `POST /me/ai-keys/test`,
 *   `PUT|DELETE /me/ai-keys/:provider` (`chat.use`; models + test share a rate limit).
 * - `GET /assistant/status` (`chat.use`): the chat header label.
 * - `GET|PUT /settings/ai` (`roles.manage`): the server-key fallback switch.
 * Keys are never logged or returned; provider failures map to fixed messages.
 */
export async function aiKeyRoutes(app: FastifyInstance) {
  const ctx = app.mock;
  const fakeAvailable = () => fakeModelAvailable(ctx.config.dev);

  const stateFor = (userId: string): AiKeysState => ({
    keys: ctx.aiKeys.list(userId),
    status: statusOf(resolveForUser(ctx, userId, fakeAvailable())),
    fallback: {
      allowed: ctx.aiKeys.allowServerKeyFallback,
      serverConfigured: aiSettingsOf(ctx).serverConfigured,
    },
    storageAvailable: secretKey() !== undefined,
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

  /** The key to check: the pasted one, else the stored one (`404` if none / unreadable). */
  const keyToCheck = (userId: string, provider: AiProvider, apiKey: string | undefined) => {
    if (apiKey !== undefined) return apiKey;
    const stored = ctx.aiKeys.storedKey(userId, provider);
    if (!stored) throw new HttpError(404, 'not_found', 'Paste a key first');
    return stored;
  };

  const logCheckFailure = (provider: AiProvider, err: KeyCheckError) =>
    app.log.warn({ provider, kind: err.kind, status: err.status }, 'AI key check failed');

  app.get('/me/ai-keys', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    return stateFor(user.id);
  });

  app.post('/me/ai-keys/models', async (req, reply) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const body = parse(aiModelsRequestSchema, req.body);
    const apiKey = keyToCheck(user.id, body.provider, body.apiKey);
    rateLimit(user.id, reply);
    try {
      return { models: await listModels(body.provider, apiKey, { fakeAvailable: fakeAvailable() }) };
    } catch (err) {
      if (!(err instanceof KeyCheckError)) throw err;
      logCheckFailure(body.provider, err);
      throw new HttpError(err.kind === 'rejected' ? 422 : 502, `key_${err.kind}`, err.message);
    }
  });

  app.post('/me/ai-keys/test', async (req, reply): Promise<AiKeyTestResult> => {
    const { user } = authorize(ctx, req, 'chat.use');
    const body = parse(aiKeyTestRequestSchema, req.body);
    const apiKey = keyToCheck(user.id, body.provider, body.apiKey);
    rateLimit(user.id, reply);
    let models: string[];
    try {
      models = await listModels(body.provider, apiKey, { fakeAvailable: fakeAvailable() });
    } catch (err) {
      if (!(err instanceof KeyCheckError)) throw err;
      logCheckFailure(body.provider, err);
      return { ok: false, message: err.message, models: [] };
    }
    if (!models.includes(body.model))
      return { ok: false, message: `Model ${body.model} isn't available for this key.`, models };
    return { ok: true, message: `Connected. ${body.model} is available.`, models };
  });

  app.put<{ Params: { provider: string } }>('/me/ai-keys/:provider', async (req) => {
    const { user } = authorize(ctx, req, 'chat.use');
    const provider = providerParam(req.params.provider);
    const body = parse(saveAiKeySchema, req.body);
    ctx.aiKeys.save(user.id, provider, body, user.id);
    app.log.info({ userId: user.id, provider, model: body.model }, 'AI key saved');
    return stateFor(user.id);
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
    return statusOf(resolveForUser(ctx, user.id, fakeAvailable()));
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
