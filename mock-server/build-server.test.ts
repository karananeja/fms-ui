// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildServer } from './build-server.ts';

describe('mock server', () => {
  it('GET /api/health returns ok', async () => {
    const app = buildServer({ vehicles: 100 });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('omits dev endpoints in production', async () => {
    const app = buildServer({ vehicles: 100, dev: false });
    const res = await app.inject({ method: 'GET', url: '/api/dev/mailbox' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
