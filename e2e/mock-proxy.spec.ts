import { expect, test } from '@playwright/test';

const wsUrl = (pageUrl: string) => new URL('/ws/live', pageUrl).href.replace(/^http/, 'ws');

test('/ws/live works through the Vite proxy with the session cookie', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { email: 'ops@fms.local', password: 'Ops@1234' },
  });
  expect(login.ok()).toBe(true);
  expect((await page.request.get('/api/auth/me')).ok()).toBe(true);

  await page.goto('/');
  const result = await page.evaluate(
    (url) =>
      new Promise<{ types: string[]; closeCode?: number }>((resolve) => {
        const types: string[] = [];
        const ws = new WebSocket(url);
        const done = (closeCode?: number) => {
          clearTimeout(timer);
          ws.close();
          resolve({ types, closeCode });
        };
        const timer = setTimeout(() => done(), 10_000);
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              id: 'e2e',
              topic: 'combinfo',
              scope: { kind: 'fleet', fleetIds: ['f3'] },
            }),
          );
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as {
            type: string;
            chunk?: number;
            chunks?: number;
          };
          types.push(msg.type);
          if (msg.type === 'snapshot' && msg.chunk === msg.chunks! - 1) done();
        };
        ws.onclose = (e) => done(e.code);
      }),
    wsUrl(page.url()),
  );
  expect(result.closeCode).toBeUndefined();
  expect(result.types[0]).toBe('subscribed');
  expect(result.types).toContain('snapshot');
});

test('/ws/live without a session closes with 4401 through the proxy', async ({ page }) => {
  await page.goto('/');
  const code = await page.evaluate(
    (url) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => resolve(-1), 10_000);
        ws.onclose = (e) => {
          clearTimeout(timer);
          resolve(e.code);
        };
      }),
    wsUrl(page.url()),
  );
  expect(code).toBe(4401);
});
