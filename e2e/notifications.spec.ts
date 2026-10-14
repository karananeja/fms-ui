import { request as apiRequest } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const SHOTS = 'docs/features/f15-in-app-notifications/screenshots';
const DRIVER = { email: 'driver@fms.local', password: 'Drive@1234' };

const bell = (page: import('@playwright/test').Page) => page.getByTestId('notification-bell');

// Both tests change the super admin's shared read state, so they run one after the other.
test.describe.configure({ mode: 'serial' });

test('F15-T5: a driver request reaches the super admin live; Mark all read sticks', async ({
  page,
  baseURL,
}) => {
  await page.goto('/admin');
  await expect(bell(page)).toBeVisible();
  // Start from zero unread so the new item is the only one.
  await bell(page).click();
  const panel = page.getByTestId('notification-panel');
  await panel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const driver = await apiRequest.newContext({ baseURL });
  expect((await driver.post('/api/auth/login', { data: DRIVER })).ok()).toBe(true);
  const note = `F15-T5 ${Date.now()}`;
  const res = await driver.post('/api/requests', { data: { type: 'rsa', note } });
  expect(res.status()).toBe(201);
  await driver.dispose();

  await expect(page.getByTestId('notification-badge')).toHaveText('1', { timeout: 5_000 });
  await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');
  await bell(page).click();
  await expect(panel.getByTestId('notification-item').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);

  await page.reload();
  await expect(bell(page)).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notifications');
  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
});

test('F15-T6: UAT screenshots', async ({ page, baseURL }) => {
  const driver = await apiRequest.newContext({ baseURL });
  expect((await driver.post('/api/auth/login', { data: DRIVER })).ok()).toBe(true);
  for (const type of ['rsa', 'replacement'] as const)
    await driver.post('/api/requests', { data: { type, note: 'F15-T6' } });
  await driver.dispose();

  await page.goto('/admin');
  await expect(page.getByTestId('notification-badge')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({
    path: `${SHOTS}/bell-badge.png`,
    clip: { x: 900, y: 0, width: 380, height: 60 },
  });
  await bell(page).click();
  await expect(page.getByTestId('notification-item').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/panel-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await bell(page).click();
  await expect(page.getByTestId('notification-item').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/sheet-mobile.png` });
});
