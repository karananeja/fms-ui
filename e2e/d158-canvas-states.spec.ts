import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

const SHOTS = 'docs/features/f23-chat-dashboard-ux/screenshots';

/**
 * D-158 (fake model, super admin): once the dock is open, an empty dashboard's canvas keeps the
 * starter's templates and chips (no second prompt box) and shows the last turn's failure with
 * Retry, plus an AI settings link for provider problems.
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
const script = async (api: APIRequestContext, data: object) =>
  expect((await api.post('/api/dev/assistant/script', { data })).ok()).toBe(true);
/** Waits until no assistant run is active (the cut turn is saved). */
const idle = (api: APIRequestContext) =>
  expect
    .poll(
      async () =>
        ((await (await api.get('/api/dev/assistant/stats')).json()) as { activeRuns: number })
          .activeRuns,
    )
    .toBe(0);

test('D-158-T1: failed turn on an empty dashboard → failure card, settings link, templates, Retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seed(page.request);
  const url = `**/api/dashboards/${d.id}/chat`;
  try {
    await page.goto(`/dashboards/${d.id}`);
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse({ type: 'error', code: 'failed', message: REJECTED }),
      }),
    );
    await page.locator('[data-template="fleet-health"]').click();
    await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-state', 'open');

    // 1) A provider rejection: the reason, AI settings, and the templates under it.
    const card = page.getByTestId('canvas-failure');
    await expect(card).toContainText("Couldn't build your dashboard");
    await expect(card).toContainText('HTTP 400');
    await expect(page.getByTestId('canvas-settings')).toHaveAttribute('href', '/settings/ai');
    const starter = page.getByTestId('dashboard-starter');
    await expect(starter).toHaveAttribute('data-compact', 'true');
    await expect(page.getByTestId('starter-template')).toHaveCount(4);
    // The dock's box is the only prompt box.
    await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toHaveCount(1);
    await shot(page, { path: `${SHOTS}/d158-canvas-failure.png` });
    await page.unroute(url);

    // 2) A chip from the canvas goes through the dock; a cut turn offers Retry on the canvas.
    await script(page.request, { name: 'cut' });
    await page.getByTestId('starter-chip').first().click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
    await expect(page.getByTestId('canvas-retry')).toBeVisible();
    await expect(page.getByTestId('canvas-settings')).toHaveCount(0);
    // After a reload the stored turn is `interrupted`; the canvas still offers Retry.
    await idle(page.request);
    await page.reload();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
    await expect(card).toContainText('cut off');
    await page.getByTestId('canvas-retry').click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(card).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
