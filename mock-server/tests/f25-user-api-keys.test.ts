// @vitest-environment node
import {
  aiKeysStateSchema,
  aiSettingsSchema,
  assistantStatusSchema,
  chatEventSchema,
  KEY_CHECK_WINDOW_MS,
  type ChatEvent,
} from '@shared/contract/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAssistant } from '../assistant/assistant-config.ts';
import {
  decryptSecret,
  encryptSecret,
  keyAad,
  maskKey,
  redactSecrets,
  secretKey,
} from '../assistant/key-crypto.ts';
import { KeyCheckError, listModels } from '../assistant/provider-models.ts';
import { Clock } from '../clock.ts';
import { migrate, openDatabase } from '../db/database.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { AiKeys } from '../store/ai-keys.ts';
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F25 (D-143) + F31 (D-171): user AI keys, enabled models and the chat choice — crypto, store, endpoints, resolution and chat use. */

process.env.FMS_ASSISTANT_FAKE = '1';
delete process.env.FMS_ASSISTANT_PROVIDER;
delete process.env.FMS_ASSISTANT_MODEL;
const SECRET = 'f25-test-secret-0123456789abcdef';
process.env.FMS_SECRET_KEY = SECRET;

const OPENAI_KEY = 'fake-openai-key-0001-9f3c';
const XAI_KEY = 'fake-xai-key-0002-77aa';

describe('F25-T1 crypto', () => {
  const key = secretKey({ FMS_SECRET_KEY: SECRET })!;

  it('round-trips, binds the AAD and needs the same secret', () => {
    const blob = encryptSecret('sk-live-abcdef123456', keyAad('u1', 'openai'), key);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob).not.toContain('abcdef123456');
    expect(decryptSecret(blob, keyAad('u1', 'openai'), key)).toBe('sk-live-abcdef123456');
    expect(decryptSecret(blob, keyAad('u2', 'openai'), key)).toBeUndefined();
    expect(decryptSecret(blob, keyAad('u1', 'xai'), key)).toBeUndefined();
    const other = secretKey({ FMS_SECRET_KEY: 'another-secret-0123456789' })!;
    expect(decryptSecret(blob, keyAad('u1', 'openai'), other)).toBeUndefined();
    expect(decryptSecret(blob, keyAad('u1', 'openai'), undefined)).toBeUndefined();
    // Random IV: the same key encrypts differently each time.
    expect(encryptSecret('x'.repeat(10), 'a', key)).not.toBe(encryptSecret('x'.repeat(10), 'a', key));
  });

  it('needs a secret of 16+ chars', () => {
    expect(secretKey({})).toBeUndefined();
    expect(secretKey({ FMS_SECRET_KEY: 'short' })).toBeUndefined();
  });

  it('masks and redacts', () => {
    expect(maskKey('xai-abcdefgh9f3c')).toBe('xai-…9f3c');
    expect(maskKey('sk-ant-api03-zzzzab12')).toBe('sk-ant-…ab12');
    expect(maskKey('sk-proj-abcdwxyz')).toBe('sk-…wxyz');
    expect(maskKey('ABCDEFGH1234')).toBe('…1234');
    const redacted = redactSecrets('Incorrect API key provided: sk-abc***wxyz. Retry.');
    expect(redacted).toMatch(/^Incorrect API key provided: \[redacted\]/);
    expect(redacted).not.toContain('wxyz');
    expect(redactSecrets('key=MYSECRETKEY!', 'MYSECRETKEY')).toBe('key=[redacted]!');
  });
});

type Seen = { url?: string; headers?: RequestInit['headers'] };
const errorCode = (body: unknown) => (body as { error: { code: string } }).error.code;

describe('F25-T3 listModels against provider APIs (stubbed fetch)', () => {
  const stub =
    (status: number, body: unknown, seen?: Seen) =>
    (async (url: string, init?: RequestInit) => {
      if (seen) Object.assign(seen, { url, headers: init?.headers });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  it('OpenAI: Bearer, sorted, non-chat models dropped', async () => {
    const seen: Seen = {};
    const models = await listModels('openai', 'sk-real', {
      fakeAvailable: true,
      fetch: stub(200, { data: [{ id: 'gpt-5' }, { id: 'text-embedding-3' }, { id: 'gpt-4.1' }] }, seen),
    });
    expect(models).toEqual(['gpt-4.1', 'gpt-5']);
    expect(seen.url).toBe('https://api.openai.com/v1/models');
    expect(seen.headers).toEqual({ authorization: 'Bearer sk-real' });
  });

  it('Anthropic: x-api-key + version header', async () => {
    const seen: Seen = {};
    await listModels('anthropic', 'sk-ant-real', {
      fakeAvailable: false,
      fetch: stub(200, { data: [{ id: 'claude-opus-5-5' }] }, seen),
    });
    expect(seen.url).toContain('api.anthropic.com/v1/models');
    expect(seen.headers).toEqual({ 'x-api-key': 'sk-ant-real', 'anthropic-version': '2023-06-01' });
  });

  it('401 → rejected with a fixed message (no provider text)', async () => {
    const err = await listModels('xai', 'xai-real', {
      fakeAvailable: true,
      fetch: stub(401, { error: 'Incorrect API key xai-real' }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCheckError);
    expect((err as KeyCheckError).kind).toBe('rejected');
    expect((err as Error).message).not.toContain('xai-real');
  });

  it('fake keys only when the fake model is available', async () => {
    expect(await listModels('xai', 'fake-k', { fakeAvailable: true })).toEqual([
      'fake-model',
      'fake-model-mini',
    ]);
    await expect(listModels('xai', 'fake-invalid', { fakeAvailable: true })).rejects.toThrow(
      /rejected/,
    );
    const real = await listModels('xai', 'fake-k', {
      fakeAvailable: false,
      fetch: stub(401, {}),
    }).catch((e: unknown) => e);
    expect((real as KeyCheckError).kind).toBe('rejected');
  });
});

describe('F25-T4 resolution order', () => {
  const env = { NODE_ENV: 'development', FMS_ASSISTANT_FAKE: '1' };
  it('user key → server (if allowed) → none', () => {
    const userKey = { provider: 'openai' as const, apiKey: 'sk-u', model: 'gpt-5' };
    expect(resolveAssistant({ userKey, allowFallback: false, fakeAvailable: true, env })).toMatchObject(
      { source: 'user', mode: 'real', provider: 'openai', apiKey: 'sk-u', model: 'gpt-5' },
    );
    expect(resolveAssistant({ allowFallback: true, fakeAvailable: true, env })).toMatchObject({
      source: 'server',
      mode: 'fake',
    });
    expect(resolveAssistant({ allowFallback: false, fakeAvailable: true, env })).toMatchObject({
      source: 'none',
      mode: 'not-configured',
      notConfigured: 'fallback_disabled',
    });
    expect(
      resolveAssistant({ allowFallback: true, fakeAvailable: false, env: { NODE_ENV: 'production' } }),
    ).toMatchObject({ source: 'none', notConfigured: 'server_not_configured' });
  });

  it('a fake user key never forwards the user key', () => {
    const r = resolveAssistant({
      userKey: { provider: 'xai', apiKey: 'fake-mine-1234', model: 'fake-model' },
      allowFallback: true,
      fakeAvailable: true,
      env,
    });
    expect(r).toMatchObject({ source: 'user', mode: 'fake', provider: 'xai' });
    expect(r.apiKey).not.toBe('fake-mine-1234');
  });
});

describe('F31 resolution additions', () => {
  const env = { NODE_ENV: 'development', FMS_ASSISTANT_FAKE: '1' };
  const userKey = { provider: 'openai' as const, apiKey: 'sk-u', model: 'gpt-5' };
  it('the picked default assistant beats the user model only while allowed', () => {
    const base = { userKey, fakeAvailable: true, preferServer: true, env };
    expect(resolveAssistant({ ...base, allowFallback: true }).source).toBe('server');
    expect(resolveAssistant({ ...base, allowFallback: false }).source).toBe('user');
  });
  it('keys without an enabled model: no_models_enabled unless the server answers', () => {
    expect(
      resolveAssistant({ allowFallback: false, fakeAvailable: true, hasKeys: true, env }),
    ).toMatchObject({ source: 'none', notConfigured: 'no_models_enabled' });
    expect(
      resolveAssistant({ allowFallback: true, fakeAvailable: true, hasKeys: true, env }).source,
    ).toBe('server');
  });
});

// ---- endpoints ----

let server: Awaited<ReturnType<typeof startServer>>;
const cookies = {} as Record<keyof typeof SEED_USERS, string>;

beforeAll(async () => {
  server = await startServer();
  for (const k of Object.keys(SEED_USERS) as (keyof typeof SEED_USERS)[])
    cookies[k] = await server.login(SEED_USERS[k]);
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.FMS_SECRET_KEY = SECRET;
  // A fresh key-check window per test (5 checks per user per minute).
  server.ctx.clock.offsetMs += KEY_CHECK_WINDOW_MS + 1_000;
});

const state = (cookie = cookies.ops) =>
  server.api('GET', '/api/me/ai-keys', { cookie, schema: aiKeysStateSchema });
const save = (provider: string, body: object, cookie = cookies.ops) =>
  server.api('PUT', `/api/me/ai-keys/${provider}`, { body, cookie, schema: aiKeysStateSchema });
const enable = (provider: string, enabled: string[], cookie = cookies.ops) =>
  server.api('PUT', `/api/me/ai-keys/${provider}/models`, {
    body: { enabled },
    cookie,
    schema: aiKeysStateSchema,
  });
const refresh = (provider: string, cookie = cookies.ops) =>
  server.api('POST', `/api/me/ai-keys/${provider}/models/refresh`, {
    cookie,
    schema: aiKeysStateSchema,
  });
const choose = (body: object, cookie = cookies.ops) =>
  server.api('PUT', '/api/me/ai-model', { body, cookie, schema: assistantStatusSchema });
const getStatus = (cookie = cookies.ops) =>
  server.api('GET', '/api/assistant/status', { cookie, schema: assistantStatusSchema });
const remove = (provider: string, cookie = cookies.ops) =>
  server.api('DELETE', `/api/me/ai-keys/${provider}`, { cookie, schema: aiKeysStateSchema });
const setFallback = (allowServerKeyFallback: boolean, cookie = cookies.superadmin) =>
  server.api('PUT', '/api/settings/ai', {
    body: { allowServerKeyFallback },
    cookie,
    schema: aiSettingsSchema,
  });
/** Save a key and enable models in one go. */
const addKey = async (provider: string, apiKey: string, enabled: string[], cookie = cookies.ops) => {
  await save(provider, { apiKey }, cookie);
  return enable(provider, enabled, cookie);
};

async function ask(question: string, cookie = cookies.ops): Promise<ChatEvent[]> {
  const res = await fetch(`${server.base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ message: question }),
  });
  return (await res.text())
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => chatEventSchema.parse(JSON.parse(l.slice(6))));
}
const lastRequest = async () =>
  (await (await fetch(`${server.base}/api/dev/assistant/last-request`)).json()) as {
    wire: string;
    body: { model?: string };
  };

describe('F25-T2 / F31-T2 save, list, remove', () => {
  it('stores encrypted with its model list, nothing enabled, audits without key material', async () => {
    const empty = await state();
    expect(empty.body).toMatchObject({ keys: [], storageAvailable: true });
    expect(empty.body.status).toMatchObject({ source: 'server', fake: true, options: [] });

    const saved = await save('openai', { apiKey: OPENAI_KEY });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(OPENAI_KEY);
    expect(saved.body.keys).toEqual([
      expect.objectContaining({
        provider: 'openai',
        masked: 'fake-…9f3c',
        readable: true,
        availableModels: ['fake-model', 'fake-model-mini'],
        enabledModels: [],
      }),
    ]);
    // No enabled model yet: the server key still answers.
    expect(saved.body.status).toMatchObject({ source: 'server', options: [] });

    const row = server.ctx.db
      .prepare("SELECT * FROM user_ai_keys WHERE user_id = 'u-ops'")
      .get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(OPENAI_KEY);
    expect(String(row.secret).startsWith('v1:')).toBe(true);

    const audit = server.ctx.aiKeys.auditEntries(5);
    expect(audit[0]).toMatchObject({ actorId: 'u-ops', action: 'ai_key.saved', target: 'u-ops' });
    expect(JSON.stringify(audit)).not.toContain(OPENAI_KEY);
    await remove('openai');
  });

  it('a model in the body is refused; a rejected key is not stored', async () => {
    expect((await save('openai', { apiKey: OPENAI_KEY, model: 'fake-model' })).status).toBe(422);
    const bad = await save('openai', { apiKey: 'fake-invalid-key-1234' });
    expect(bad.status).toBe(422);
    expect(errorCode(bad.body)).toBe('key_rejected');
    expect((await state()).body.keys).toEqual([]);
  });

  it('refuses to store without FMS_SECRET_KEY; stored keys become unreadable', async () => {
    await addKey('openai', OPENAI_KEY, ['fake-model']);
    delete process.env.FMS_SECRET_KEY;
    const refused = await save('xai', { apiKey: XAI_KEY });
    expect(refused.status).toBe(409);
    expect(errorCode(refused.body)).toBe('secret_missing');
    const s = (await state()).body;
    expect(s.storageAvailable).toBe(false);
    expect(s.keys[0]).toMatchObject({ provider: 'openai', readable: false });
    expect(s.status).toMatchObject({ source: 'server', options: [] });
    process.env.FMS_SECRET_KEY = SECRET;
    await remove('openai');
  });

  it('validates input and permissions', async () => {
    expect((await save('openai', { apiKey: 'has space key' })).status).toBe(422);
    expect((await save('gemini', { apiKey: OPENAI_KEY })).status).toBe(404);
    expect((await state(cookies.viewer)).status).toBe(403);
    expect((await remove('openai')).status).toBe(404);
  });
});

describe('F31-T3 enable and refresh', () => {
  it('only available models, at most 20; the first enable becomes the choice', async () => {
    await save('xai', { apiKey: XAI_KEY });
    const unknown = await enable('xai', ['grok-9']);
    expect(unknown.status).toBe(422);
    expect((await enable('xai', Array.from({ length: 21 }, (_, i) => `m${i}`))).status).toBe(422);
    const s = (await enable('xai', ['fake-model-mini', 'fake-model'])).body;
    expect(s.keys[0]?.enabledModels).toEqual(['fake-model-mini', 'fake-model']);
    expect(s.status).toMatchObject({
      source: 'user',
      provider: 'xai',
      model: 'fake-model-mini',
      options: [
        { provider: 'xai', model: 'fake-model-mini' },
        { provider: 'xai', model: 'fake-model' },
      ],
    });
    expect(server.ctx.aiKeys.auditEntries(1)[0]).toMatchObject({
      action: 'ai_key.models_updated',
      details: { provider: 'xai', enabled: ['fake-model-mini', 'fake-model'] },
    });
  });

  it('refresh drops enabled models that are gone; replacing a key keeps the rest', async () => {
    // Simulate a model the provider no longer lists.
    server.ctx.db
      .prepare(
        "UPDATE user_ai_keys SET available_models = json('[\"fake-model\",\"fake-model-mini\",\"old\"]'), enabled_models = json('[\"old\",\"fake-model\"]'), model = 'old', active = 1 WHERE user_id = 'u-ops'",
      )
      .run();
    server.ctx.aiKeys.hydrate();
    expect((await getStatus()).body.model).toBe('old');
    const s = (await refresh('xai')).body;
    expect(s.keys[0]).toMatchObject({
      availableModels: ['fake-model', 'fake-model-mini'],
      enabledModels: ['fake-model'],
    });
    expect(s.status.model).toBe('fake-model');
    const replaced = (await save('xai', { apiKey: XAI_KEY })).body;
    expect(replaced.keys[0]?.enabledModels).toEqual(['fake-model']);
    expect((await refresh('anthropic')).status).toBe(404);
    await remove('xai');
  });

  it('rate-limits the 6th key check in a minute', async () => {
    await save('xai', { apiKey: XAI_KEY });
    for (let i = 0; i < 4; i++) expect((await refresh('xai')).status).toBe(200);
    const limited = await refresh('xai');
    expect(limited.status).toBe(429);
    expect(errorCode(limited.body)).toBe('rate_limited');
    server.ctx.clock.offsetMs += KEY_CHECK_WINDOW_MS + 1_000;
    await remove('xai');
  });
});

describe('F31-T4 / T5 choice and status', () => {
  it('only enabled models can be chosen; the choice moves when it is disabled or removed', async () => {
    await addKey('xai', XAI_KEY, ['fake-model']);
    await addKey('openai', OPENAI_KEY, ['fake-model-mini', 'fake-model']);
    // The first enable (xai) stays the choice.
    expect((await getStatus()).body).toMatchObject({ provider: 'xai', model: 'fake-model' });
    const refused = await choose({ provider: 'openai', model: 'grok-4' });
    expect(refused.status).toBe(422);
    expect(errorCode(refused.body)).toBe('model_not_enabled');
    expect((await choose({ provider: 'openai', model: 'fake-model' })).body).toMatchObject({
      source: 'user',
      provider: 'openai',
      model: 'fake-model',
    });
    // Disabling the chosen model → the key's next enabled model.
    expect((await enable('openai', ['fake-model-mini'])).body.status.model).toBe('fake-model-mini');
    // Removing the chosen key → the other key's model.
    expect((await remove('openai')).body.status).toMatchObject({ provider: 'xai', model: 'fake-model' });
    // No enabled models left and no fallback → no_models_enabled.
    await setFallback(false);
    expect((await enable('xai', [])).body.status).toMatchObject({
      source: 'none',
      reason: 'no_models_enabled',
      options: [],
      serverOption: null,
    });
    await setFallback(true);
    await remove('xai');
  });

  it('the default assistant can be picked only while the org allows it', async () => {
    await addKey('xai', XAI_KEY, ['fake-model']);
    const s = (await getStatus()).body;
    expect(s.serverOption).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect((await choose({ source: 'server' })).body).toMatchObject({ source: 'server' });
    await setFallback(false);
    expect((await getStatus()).body).toMatchObject({ source: 'user', serverOption: null });
    const refused = await choose({ source: 'server' });
    expect(refused.status).toBe(409);
    await setFallback(true);
    // Picking a model of a key clears the server choice.
    expect((await choose({ source: 'server' })).body.source).toBe('server');
    expect((await choose({ provider: 'xai', model: 'fake-model' })).body.source).toBe('user');
    await remove('xai');
  });
});

describe('F25-T5 / F31-T4 chat uses the chosen model; F25-T4 fallback switch', () => {
  it('the chosen model picks the wire and model of the next turn', async () => {
    await ask('hello');
    expect((await lastRequest()).wire).toBe('anthropic');
    await addKey('openai', OPENAI_KEY, ['fake-model-mini', 'fake-model']);
    expect((await ask('hello')).at(-1)?.type).toBe('done');
    expect(await lastRequest()).toMatchObject({ wire: 'openai', body: { model: 'fake-model-mini' } });
    await choose({ provider: 'openai', model: 'fake-model' });
    await ask('hello');
    expect(await lastRequest()).toMatchObject({ wire: 'openai', body: { model: 'fake-model' } });
    const usage = server.ctx.db
      .prepare("SELECT model FROM ai_usage WHERE user_id = 'u-ops' ORDER BY at DESC LIMIT 1")
      .get();
    // F30 records fake runs as provider `fake`; the model is the chosen one.
    expect(usage).toEqual({ model: 'fake-model' });
    await choose({ source: 'server' });
    await ask('hello');
    expect((await lastRequest()).wire).toBe('anthropic');
    await choose({ provider: 'openai', model: 'fake-model' });
  });

  it('fallback off: no key → not_configured; removing the key falls back when on', async () => {
    expect((await setFallback(false, cookies.ops)).status).toBe(403);
    expect((await setFallback(false)).body.allowServerKeyFallback).toBe(false);
    // ops still has a key: unaffected.
    expect((await ask('hello')).at(-1)?.type).toBe('done');
    await remove('openai');
    const events = await ask('hello');
    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'not_configured' })]);
    expect((await state()).body.status).toMatchObject({ source: 'none', reason: 'fallback_disabled' });
    await setFallback(true);
    expect((await ask('hello')).at(-1)?.type).toBe('done');
    expect(server.ctx.aiKeys.auditEntries(10).map((e) => e.action)).toContain('ai_settings.updated');
  });
});

describe('F25-T6 / T7 / F31-T1 persistence, migration, user deletion, dev reset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fms-f25-'));
  const dbPath = join(dir, 'fms.db');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('an F25 key (v16) keeps its model after migration v17', () => {
    const db = openDatabase(':memory:', MIGRATIONS.filter((m) => m.version <= 16));
    db.exec('PRAGMA foreign_keys = OFF');
    const secret = encryptSecret(XAI_KEY, keyAad('u1', 'xai'), secretKey()!);
    db.prepare(
      "INSERT INTO user_ai_keys (user_id, provider, model, secret, masked, active, created_at, updated_at) VALUES ('u1', 'xai', 'grok-4', ?, 'fake-…77aa', 1, 1, 1)",
    ).run(secret);
    migrate(db, MIGRATIONS, Date.now);
    const keys = new AiKeys(db, new Clock());
    keys.hydrate();
    expect(keys.list('u1')[0]).toMatchObject({ enabledModels: ['grok-4'], availableModels: ['grok-4'] });
    expect(keys.userModel('u1')).toEqual({ provider: 'xai', apiKey: XAI_KEY, model: 'grok-4' });
    db.close();
  });

  it('keys, choice and the setting survive a restart; deleting the user deletes the keys', async () => {
    const a = await startServer({ dbPath });
    const cookie = await a.login(SEED_USERS.ops);
    const admin = await a.login(SEED_USERS.superadmin);
    await a.api('PUT', '/api/me/ai-keys/xai', {
      body: { apiKey: XAI_KEY },
      cookie,
      schema: aiKeysStateSchema,
    });
    await a.api('PUT', '/api/me/ai-keys/xai/models', {
      body: { enabled: ['fake-model', 'fake-model-mini'] },
      cookie,
      schema: aiKeysStateSchema,
    });
    await a.api('PUT', '/api/me/ai-model', {
      body: { provider: 'xai', model: 'fake-model-mini' },
      cookie,
      schema: assistantStatusSchema,
    });
    await a.api('PUT', '/api/settings/ai', {
      body: { allowServerKeyFallback: false },
      cookie: admin,
      schema: aiSettingsSchema,
    });
    await a.close();

    const b = await startServer({ dbPath });
    try {
      expect(b.ctx.aiKeys.allowServerKeyFallback).toBe(false);
      expect(b.ctx.aiKeys.userModel('u-ops')).toEqual({
        provider: 'xai',
        apiKey: XAI_KEY,
        model: 'fake-model-mini',
      });
      b.ctx.db.prepare("DELETE FROM users WHERE id = 'u-ops'").run();
      expect(b.ctx.db.prepare('SELECT COUNT(*) AS n FROM user_ai_keys').get()).toEqual({ n: 0 });
    } finally {
      await b.close();
    }
  });

  it('dev reset wipes keys, prefs, settings and audit', async () => {
    const cookie = cookies.ops;
    await addKey('xai', XAI_KEY, ['fake-model'], cookie);
    await choose({ source: 'server' }, cookie);
    const res = await fetch(`${server.base}/api/dev/reset`, { method: 'POST' });
    expect(res.status).toBeLessThan(300);
    expect(server.ctx.db.prepare('SELECT COUNT(*) AS n FROM user_ai_keys').get()).toEqual({ n: 0 });
    expect(server.ctx.db.prepare('SELECT COUNT(*) AS n FROM user_ai_prefs').get()).toEqual({ n: 0 });
    expect(server.ctx.aiKeys.userModel('u-ops')).toBeUndefined();
    expect(server.ctx.aiKeys.prefersServer('u-ops')).toBe(false);
    expect(server.ctx.aiKeys.auditEntries()).toEqual([]);
    expect(server.ctx.aiKeys.allowServerKeyFallback).toBe(true);
  });
});
