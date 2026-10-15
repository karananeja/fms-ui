import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * D-135 P-T5 / P-T6 (fake model, super admin): single-widget requests show a live preview card
 * in the chat; Add / drag onto the grid / the global "Add to dashboard…" picker put it on a
 * dashboard; card states persist in the dashboard thread.
 */

const SHOTS = 'docs/features/f20-dashboards-ui/screenshots';
const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });

type Layout = { i: string; x: number; y: number; w: number; h: number }[];
type Dash = {
  id: string;
  widgets: { id: string; type: string; title: string }[];
  layout: { lg: Layout };
};

async function seed(api: APIRequestContext, title: string): Promise<Dash> {
  const res = await api.post('/api/dashboards', {
    data: { title, widgets: [{ type: 'text', title: 'Alpha', body: 'Note **Alpha**' }] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Dash;
}
const read = async (api: APIRequestContext, id: string) =>
  (await (await api.get(`/api/dashboards/${id}`)).json()) as Dash;

/** Sends in the dashboard dock and waits for the whole turn. */
async function say(page: Page, id: string, message: string) {
  const res = page.waitForResponse((r) => r.url().endsWith(`/api/dashboards/${id}/chat`));
  await box(page).fill(message);
  await box(page).press('Enter');
  await (await res).finished();
  await expect(page.getByTestId('assistant-message').last()).toHaveAttribute('data-status', 'done');
}

test('P-T5: preview → Add, a second preview dragged onto the grid; both persist', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('fms.dashboards.chat', 'open'));
  const d = await seed(page.request, 'Preview test');
  try {
    await page.goto(`/dashboards/${d.id}`);
    const grid = page.getByTestId('dashboard-grid');
    await expect(grid).toHaveAttribute('data-breakpoint', 'lg');
    await expect(page.locator('.react-grid-item')).toHaveCount(1);

    await say(page, d.id, 'add a small KPI of running vehicles');
    const first = page.getByTestId('widget-preview').first();
    await expect(first).toBeVisible();
    await expect(first.getByRole('heading', { name: 'Running vehicles' })).toBeVisible();
    // Live data (the worker's count), not just the skeleton.
    await expect(first.getByTestId('preview-body')).toContainText(/\d/);
    // The dashboard did not change yet.
    expect((await read(page.request, d.id)).widgets).toHaveLength(1);

    await first.getByTestId('preview-add').click();
    await expect(first.getByTestId('preview-added')).toHaveText('Added ✓');
    await expect(page.locator('.react-grid-item')).toHaveCount(2);

    await say(page, d.id, 'add a small KPI of stopped vehicles');
    const second = page.getByTestId('widget-preview').nth(1);
    await expect(second.getByRole('heading', { name: 'Stopped vehicles' })).toBeVisible();
    await shot(page, { path: `${SHOTS}/p-t5-preview-card.png` });
    const gridBox = (await grid.boundingBox())!;
    await second.locator('header').dragTo(grid, {
      targetPosition: { x: Math.round(gridBox.width * 0.75), y: 20 },
    });
    await expect(second.getByTestId('preview-added')).toHaveText('Added ✓');
    await expect(page.locator('.react-grid-item')).toHaveCount(3);

    await expect.poll(async () => (await read(page.request, d.id)).widgets.length).toBe(3);
    const saved = await read(page.request, d.id);
    const stopped = saved.widgets.find((w) => w.title === 'Stopped vehicles')!;
    const at = saved.layout.lg.find((it) => it.i === stopped.id)!;
    // Dropped on the right of the top row.
    expect(at.y).toBe(0);
    expect(at.x).toBeGreaterThanOrEqual(6);

    await page.reload();
    await expect(page.locator('.react-grid-item')).toHaveCount(3);
    const cards = page.getByTestId('widget-preview');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-status', 'added');
    await expect(cards.nth(1)).toHaveAttribute('data-status', 'added');
    await expect(page.getByTestId('preview-add')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('P-T6: global panel preview → Add to dashboard… → pick a dashboard', async ({ page }) => {
  const d = await seed(page.request, 'Global preview target');
  try {
    await page.goto('/admin');
    await page.getByTestId('ask-fms').click();
    await box(page).fill('add a small KPI of running vehicles');
    await box(page).press('Enter');
    const card = page.getByTestId('widget-preview');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Running vehicles' })).toBeVisible();

    await card.getByTestId('preview-add-picker').click();
    const picker = page.getByTestId('dashboard-picker');
    await expect(picker.getByTestId('picker-new')).toBeVisible();
    await picker
      .getByTestId('picker-dashboard')
      .filter({ hasText: 'Global preview target' })
      .click();
    await expect(card.getByTestId('preview-added')).toHaveText('Added ✓');
    await shot(page, { path: `${SHOTS}/p-t6-global-picker.png` });

    const saved = await read(page.request, d.id);
    expect(saved.widgets.map((w) => w.title)).toEqual(['Alpha', 'Running vehicles']);

    await card.getByTestId('preview-open-dashboard').click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${d.id}`));
    await expect(page.locator('.react-grid-item')).toHaveCount(2);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
