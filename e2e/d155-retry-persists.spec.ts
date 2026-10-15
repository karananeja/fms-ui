import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * D-155 (fake model, super admin): a failed or interrupted chat turn keeps its Retry when the
 * user leaves the dashboard and comes back, and after a reload; Retry re-runs that turn in place
 * (one user message). The global Ask FMS panel keeps Retry when closed and reopened.
 */

const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });
const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const CUT_BODY = `: ping\n\n${sse({ type: 'text', delta: 'Partial answer' })}`;
const tag = () => `d155${Math.random().toString(36).slice(2, 8)}`;

async function seed(api: APIRequestContext) {
  const res = await api.post('/api/dashboards', {
    data: { title: `Retry ${tag()}`, widgets: [{ type: 'text', title: 'Alpha', body: 'Note' }] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
const script = async (api: APIRequestContext, data: object) =>
  expect((await api.post('/api/dev/assistant/script', { data })).ok()).toBe(true);
/** Waits until no assistant run is active (the interrupted turn is saved). */
const idle = (api: APIRequestContext) =>
  expect
    .poll(async () => ((await (await api.get('/api/dev/assistant/stats')).json()) as {
      activeRuns: number;
    }).activeRuns)
    .toBe(0);

test('D-155-T1: dashboard chat — Retry survives leaving the page and a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = await seed(page.request);
  try {
    await page.goto(`/dashboards/${d.id}`);
    await expect(page.locator('.react-grid-item')).toHaveCount(1);
    const dock = page.getByTestId('chat-dock');

    // 1) Leave mid-answer: the turn is stored `interrupted`.
    await script(page.request, { name: 'slow' });
    await box(page).fill('hello there');
    await box(page).press('Enter');
    await expect(lastAnswer(page)).toContainText('word1');
    await page.getByTestId('back-to-dashboards').click();
    await expect(page).toHaveURL(/\/dashboards(\?|$)/);
    await idle(page.request);
    await page.goBack();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
    await expect(page.getByTestId('assistant-retry')).toBeVisible();
    await page.getByTestId('assistant-retry').click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(dock.getByTestId('user-message')).toHaveCount(1);
    await expect(page.getByTestId('assistant-retry')).toHaveCount(0);

    // 2) A provider cut (error live), then a reload: Retry is still there.
    await script(page.request, { name: 'cut' });
    await box(page).fill('and again');
    await box(page).press('Enter');
    await expect(page.getByTestId('assistant-retry')).toBeVisible({ timeout: 15_000 });
    await idle(page.request);
    await page.reload();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
    await expect(lastAnswer(page)).toContainText('Partial answer that never');
    await page.getByTestId('assistant-retry').click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
    await expect(dock.getByTestId('user-message')).toHaveCount(2);

    // The server thread agrees: two turns, both done.
    const thread = (await (await page.request.get(`/api/dashboards/${d.id}/thread`)).json()) as {
      messages: { role: string; outcome: string }[];
    };
    expect(thread.messages.map((m) => `${m.role}:${m.outcome}`)).toEqual([
      'user:done',
      'assistant:done',
      'user:done',
      'assistant:done',
    ]);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('D-155-T2: global Ask FMS keeps Retry when the panel is closed and reopened', async ({
  page,
}) => {
  await page.goto('/admin');
  await page.getByTestId('ask-fms').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: CUT_BODY }),
  );
  await box(page).fill('Which vehicles have no GPS right now?');
  await box(page).press('Enter');
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await page.getByTestId('ask-fms').click();
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'interrupted');
  await expect(page.getByTestId('assistant-retry')).toBeVisible();
  await page.unroute('**/api/chat');
  await page.getByTestId('assistant-retry').click();
  await expect(lastAnswer(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(page.getByTestId('user-message')).toHaveCount(1);
});
