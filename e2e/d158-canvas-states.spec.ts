import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

const SHOTS = 'docs/features/f23-chat-dashboard-ux/screenshots';

/**
 * D-158 (fake model, super admin): once the dock is open, an empty dashboard's canvas keeps the
 * starter's templates and chips (no second prompt box) and shows the last turn's failure with
 * Retry, plus an AI settings link for provider problems. Failures are stubbed in the browser
 * (not the shared fake-model script queue, which parallel specs would race for).
 */

const tag = () => `d158${Math.random().toString(36).slice(2, 8)}`;
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const REJECTED =
  'The AI provider rejected the request (HTTP 400). Check the model chosen in AI settings, or ask an administrator.';
const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();

async function seed(api: APIRequestContext) {
  const res = await api.post('/api/dashboards', {
    data: { title: `Canvas ${tag()}`, widgets: [] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
const failWith = (page: Page, url: string, error: object) =>
  page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse({ type: 'error', ...error }),
    }),
  );

test('D-158-T1: failed turn on an empty dashboard → failure card, settings link, templates, Retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seed(page.request);
  const url = `**/api/dashboards/${d.id}/chat`;
  try {
    await page.goto(`/dashboards/${d.id}`);
    await failWith(page, url, { code: 'failed', message: REJECTED });
    await page.locator('[data-template="fleet-health"]').click();
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'open');

    // 1) A provider rejection: the reason, AI settings, and the templates under it.
    const card = page.getByTestId('canvas-failure');
    await expect(card).toContainText("Couldn't build your dashboard");
    await expect(card).toContainText('HTTP 400');
    await expect(page.getByTestId('canvas-settings')).toHaveAttribute('href', '/settings/ai');
    await expect(page.getByTestId('dashboard-starter')).toHaveAttribute('data-compact', 'true');
    await expect(page.getByTestId('starter-template')).toHaveCount(4);
    // The dock's box is the only prompt box.
    await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toHaveCount(1);
    await shot(page, { path: `${SHOTS}/d158-canvas-failure.png` });
    await page.unroute(url);

    // 2) A chip from the canvas goes through the dock; a busy turn: Retry, no settings link.
    await failWith(page, url, { code: 'busy', message: 'busy' });
    await page.getByTestId('starter-chip').first().click();
    await expect(card).toContainText('Assistant is busy');
    await expect(page.getByTestId('canvas-settings')).toHaveCount(0);
    await page.unroute(url);
    await page.getByTestId('canvas-retry').click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(card).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
