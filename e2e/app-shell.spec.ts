import { expect, test } from './fixtures.ts';

test('redirects / to /live-tracking with nav and title visible', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/live-tracking$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live tracking' })).toBeVisible();
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('hides the side nav and opens the drawer from the menu button', async ({ page }) => {
    await page.goto('/live-tracking');
    await expect(page.getByRole('heading', { name: 'Live tracking' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Drawer navigation' })).toBeVisible();

    await drawer.getByRole('link', { name: 'Fleets' }).click();
    await expect(page).toHaveURL(/\/admin\/fleets$/);
    await expect(drawer).toBeHidden();
  });
});

test('GET /api/health through the Vite proxy returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ ok: true });
});
