// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildServer } from './build-server.ts';

describe('mock server stub', () => {
  it('GET /api/health returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
