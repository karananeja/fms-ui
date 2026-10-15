import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * F19-T10 (intent "done when"), fake model, as the super admin: one global prompt builds a
 * dashboard (3 widgets), then its own chat changes one widget, removes one, renames the
 * dashboard, Undo restores it, and a reload brings the thread and chips back.
 * The prompts use the documented fake-model trigger words (D-126).
 */

const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });

/** Sends in the dashboard dock and waits for the whole turn. */
async function say(page: Page, id: string, message: string) {
  const res = page.waitForResponse((r) => r.url().endsWith(`/api/dashboards/${id}/chat`));
  await box(page).fill(message);
  await box(page).press('Enter');
  await (await res).finished();
  await expect(page.getByTestId('assistant-message').last()).toHaveAttribute('data-status', 'done');
}

test('F19-T10: build from the global chat, refine in the dashboard chat, undo, resume', async ({
  page,
}) => {
  await page.goto('/admin');
  await page.getByTestId('ask-fms').click();
  await box(page).fill('Build a dashboard of running vs stopped and top idle vehicles');
  await box(page).press('Enter');
  const link = page.getByTestId('dashboard-link');
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  const id = href.split('/').at(-1)!;
  try {
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${id}`));
    const grid = page.locator('.react-grid-item');
    await expect(grid).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible();
    // The creating turn was copied into this dashboard's thread.
    await expect(
      page.getByTestId('change-chip').or(page.getByTestId('tool-chip')).first(),
    ).toBeVisible();

    await say(page, id, 'make the ranking 30 days');
    await expect(
      page.getByTestId('change-chip').filter({ hasText: 'Updated widget: Top idle vehicles' }),
    ).toBeVisible();
    const after = await (await page.request.get(`/api/dashboards/${id}`)).json();
    expect(after.widgets.find((w: { type: string }) => w.type === 'ranking').range).toBe('30d');

    await say(page, id, 'remove the running vehicles widget');
    await expect(
      page.getByTestId('change-chip').filter({ hasText: 'Removed widget: Running vehicles' }),
    ).toBeVisible();
    await expect(grid).toHaveCount(2);

    await say(page, id, 'rename the dashboard to "Ops today"');
    await expect(page.getByRole('heading', { name: 'Ops today' })).toBeVisible();

    // Undo is offered on the latest change only.
    const undo = page.getByTestId('change-undo');
    await expect(undo).toHaveCount(1);
    await undo.click();
    await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible();
    await expect(page.getByTestId('change-undone')).toHaveCount(1);
    await expect(grid).toHaveCount(2);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible();
    await expect(page.getByTestId('user-message')).toHaveCount(4);
    await expect(
      page.getByTestId('change-chip').filter({ hasText: 'Renamed dashboard to "Ops today"' }),
    ).toBeVisible();
    await expect(page.getByTestId('change-undone')).toHaveCount(1);
    await expect(page.getByTestId('change-undo')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/dashboards/${id}`);
  }
});
