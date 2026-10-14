import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, setUnauthorizedHandler } from './api-client.ts';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubFetch(res: Response | Error) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe('F02-T3: api-client', () => {
  it('sends JSON with the session cookie and parses the JSON reply', async () => {
    const fetch = stubFetch(json(200, { ok: true }));
    await expect(apiFetch('/api/x', { body: { a: 1 } })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      signal: undefined,
    });
  });

  it('GET by default; 204 → undefined', async () => {
    const fetch = stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/y')).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('parses the error body into a typed ApiError', async () => {
    const details = [{ path: ['password'], message: 'Password must contain a number' }];
    stubFetch(json(422, { error: { code: 'validation_failed', message: 'Bad', details } }));
    const err = await apiFetch('/api/z').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', message: 'Bad', details });
    expect((err as ApiError).unreachable).toBe(false);
  });

  it('network failure and 5xx are "unreachable"', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    const net = await apiFetch('/api/z').catch((e: unknown) => e);
    expect(net).toMatchObject({ status: 0, code: 'network', unreachable: true });
    stubFetch(new Response('oops', { status: 502 }));
    const bad = await apiFetch('/api/z').catch((e: unknown) => e);
    expect(bad).toMatchObject({ status: 502, code: 'internal', unreachable: true });
  });

  it('a 401 calls the session hook, except from POST /api/auth/login', async () => {
    const expire = vi.fn();
    setUnauthorizedHandler(expire);
    const body = { error: { code: 'unauthenticated', message: 'Sign in required' } };
    stubFetch(json(401, body));
    await expect(apiFetch('/api/fleets')).rejects.toMatchObject({ status: 401 });
    expect(expire).toHaveBeenCalledTimes(1);
    stubFetch(json(401, { error: { code: 'invalid_credentials', message: 'Invalid' } }));
    await expect(apiFetch('/api/auth/login', { body: {} })).rejects.toMatchObject({ status: 401 });
    expect(expire).toHaveBeenCalledTimes(1);
    stubFetch(json(403, { error: { code: 'forbidden', message: 'No' } }));
    await expect(apiFetch('/api/fleets')).rejects.toMatchObject({ status: 403 });
    expect(expire).toHaveBeenCalledTimes(1);
  });
});
