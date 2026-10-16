// @vitest-environment node
import {
  aiKeysStateSchema,
  aiKeyTestResultSchema,
  aiModelsResponseSchema,
  aiSettingsSchema,
  assistantStatusSchema,
  chatEventSchema,
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
import { SEED_USERS, startServer } from '../testing/harness.ts';

/** F25 (D-143): user AI keys — crypto, store, endpoints, resolution and chat use. */

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
});

const state = (cookie = cookies.ops) =>
  server.api('GET', '/api/me/ai-keys', { cookie, schema: aiKeysStateSchema });
const save = (provider: string, body: object, cookie = cookies.ops) =>
  server.api('PUT', `/api/me/ai-keys/${provider}`, { body, cookie, schema: aiKeysStateSchema });
const remove = (provider: string, cookie = cookies.ops) =>
  server.api('DELETE', `/api/me/ai-keys/${provider}`, { cookie, schema: aiKeysStateSchema });
const setFallback = (allowServerKeyFallback: boolean, cookie = cookies.superadmin) =>
  server.api('PUT', '/api/settings/ai', {
    body: { allowServerKeyFallback },
    cookie,
    schema: aiSettingsSchema,
  });

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

describe('F25-T2 save, list, remove', () => {
  it('stores encrypted, returns only the masked key, audits without key material', async () => {
    const empty = await state();
    expect(empty.body).toMatchObject({ keys: [], storageAvailable: true });
    expect(empty.body.status).toMatchObject({ source: 'server', fake: true });

    const saved = await save('openai', { apiKey: OPENAI_KEY, model: 'fake-model-mini' });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(OPENAI_KEY);
    expect(saved.body.keys).toEqual([
      expect.objectContaining({
        provider: 'openai',
        model: 'fake-model-mini',
        masked: 'fake-…9f3c',
        active: true,
        readable: true,
      }),
    ]);
    expect(saved.body.status).toMatchObject({
      source: 'user',
      provider: 'openai',
      model: 'fake-model-mini',
    });

    const row = server.ctx.db
      .prepare("SELECT * FROM user_ai_keys WHERE user_id = 'u-ops'")
      .get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(OPENAI_KEY);
    expect(String(row.secret).startsWith('v1:')).toBe(true);

    const audit = server.ctx.aiKeys.auditEntries(5);
    expect(audit[0]).toMatchObject({ actorId: 'u-ops', action: 'ai_key.saved', target: 'u-ops' });
    expect(JSON.stringify(audit)).not.toContain(OPENAI_KEY);
  });

  it('the last saved key is active; "use" re-saves without a key; remove promotes', async () => {
    await save('xai', { apiKey: XAI_KEY, model: 'fake-model' });
    let s = (await state()).body;
    expect(s.keys.map((k) => [k.provider, k.active])).toEqual([
      ['xai', true],
      ['openai', false],
    ]);
    s = (await save('openai', { model: 'fake-model-mini' })).body;
    expect(s.keys.find((k) => k.active)?.provider).toBe('openai');
    s = (await remove('openai')).body;
    expect(s.keys).toEqual([expect.objectContaining({ provider: 'xai', active: true })]);
    expect(server.ctx.aiKeys.auditEntries(1)[0]).toMatchObject({
      action: 'ai_key.removed',
      details: { provider: 'openai' },
    });
    expect((await remove('openai')).status).toBe(404);
    expect((await save('openai', { model: 'x' })).status).toBe(404);
    expect((await remove('xai')).body.keys).toEqual([]);
  });

  it('refuses to store without FMS_SECRET_KEY; stored keys become unreadable', async () => {
    await save('openai', { apiKey: OPENAI_KEY, model: 'fake-model' });
    delete process.env.FMS_SECRET_KEY;
    const refused = await save('xai', { apiKey: XAI_KEY, model: 'fake-model' });
    expect(refused.status).toBe(409);
    expect(errorCode(refused.body)).toBe('secret_missing');
    const s = (await state()).body;
    expect(s.storageAvailable).toBe(false);
    expect(s.keys[0]).toMatchObject({ provider: 'openai', readable: false });
    expect(s.status.source).toBe('server');
    process.env.FMS_SECRET_KEY = SECRET;
    await remove('openai');
  });

  it('validates input and permissions', async () => {
    expect((await save('openai', { apiKey: 'has space key', model: 'm' })).status).toBe(422);
    expect((await save('gemini', { apiKey: OPENAI_KEY, model: 'm' })).status).toBe(404);
    expect((await state(cookies.viewer)).status).toBe(403);
  });
});

describe('F25-T3 models and test connection', () => {
  const models = (body: object) =>
    server.api('POST', '/api/me/ai-keys/models', {
      body,
      cookie: cookies.superadmin,
      schema: aiModelsResponseSchema,
    });
  const test = (body: object) =>
    server.api('POST', '/api/me/ai-keys/test', {
      body,
      cookie: cookies.superadmin,
      schema: aiKeyTestResultSchema,
    });

  it('lists, tests, rejects, then rate-limits the 6th check in a minute', async () => {
    expect((await models({ provider: 'xai', apiKey: XAI_KEY })).body.models).toContain('fake-model');
    expect((await test({ provider: 'xai', apiKey: XAI_KEY, model: 'fake-model' })).body).toMatchObject(
      { ok: true },
    );
    const bad = await test({ provider: 'openai', apiKey: 'fake-invalid-key', model: 'fake-model' });
    expect(bad.body).toMatchObject({ ok: false, message: 'OpenAI rejected this key.' });
    expect((await test({ provider: 'xai', apiKey: XAI_KEY, model: 'grok-9' })).body).toMatchObject({
      ok: false,
      message: "Model grok-9 isn't available for this key.",
    });
    expect((await models({ provider: 'openai', apiKey: 'fake-invalid-key' })).status).toBe(422);
    const limited = await models({ provider: 'xai', apiKey: XAI_KEY });
    expect(limited.status).toBe(429);
    expect(errorCode(limited.body)).toBe('rate_limited');
  });

  it('without apiKey uses the stored key, or 404', async () => {
    const res = await server.api('POST', '/api/me/ai-keys/models', {
      body: { provider: 'anthropic' },
      cookie: cookies.ops,
      schema: aiModelsResponseSchema,
    });
    expect(res.status).toBe(404);
  });
});

describe('F25-T5 chat uses the user key; F25-T4 fallback switch', () => {
  it('user key on the OpenAI wire while the server is on the Anthropic wire', async () => {
    await ask('hello');
    expect((await lastRequest()).wire).toBe('anthropic');
    await save('openai', { apiKey: OPENAI_KEY, model: 'fake-model-mini' });
    const events = await ask('hello');
    expect(events.at(-1)?.type).toBe('done');
    expect(await lastRequest()).toMatchObject({ wire: 'openai', body: { model: 'fake-model-mini' } });
    const status = await server.api('GET', '/api/assistant/status', {
      cookie: cookies.ops,
      schema: assistantStatusSchema,
    });
    expect(status.body).toEqual({
      source: 'user',
      provider: 'openai',
      model: 'fake-model-mini',
      fake: true,
      reason: null,
    });
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

describe('F25-T6 / T7 persistence, user deletion, dev reset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fms-f25-'));
  const dbPath = join(dir, 'fms.db');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keys and the setting survive a restart; deleting the user deletes the keys', async () => {
    const a = await startServer({ dbPath });
    const cookie = await a.login(SEED_USERS.ops);
    const admin = await a.login(SEED_USERS.superadmin);
    await a.api('PUT', '/api/me/ai-keys/xai', {
      body: { apiKey: XAI_KEY, model: 'fake-model' },
      cookie,
      schema: aiKeysStateSchema,
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
      expect(b.ctx.aiKeys.activeKey('u-ops')).toEqual({
        provider: 'xai',
        apiKey: XAI_KEY,
        model: 'fake-model',
      });
      b.ctx.db.prepare("DELETE FROM users WHERE id = 'u-ops'").run();
      expect(b.ctx.db.prepare('SELECT COUNT(*) AS n FROM user_ai_keys').get()).toEqual({ n: 0 });
    } finally {
      await b.close();
    }
  });

  it('dev reset wipes keys, settings and audit', async () => {
    const cookie = cookies.ops;
    await save('xai', { apiKey: XAI_KEY, model: 'fake-model' }, cookie);
    const res = await fetch(`${server.base}/api/dev/reset`, { method: 'POST' });
    expect(res.status).toBeLessThan(300);
    expect(server.ctx.db.prepare('SELECT COUNT(*) AS n FROM user_ai_keys').get()).toEqual({ n: 0 });
    expect(server.ctx.aiKeys.activeKey('u-ops')).toBeUndefined();
    expect(server.ctx.aiKeys.auditEntries()).toEqual([]);
    expect(server.ctx.aiKeys.allowServerKeyFallback).toBe(true);
  });
});
