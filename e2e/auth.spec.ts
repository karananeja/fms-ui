import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { adminApi, createUser, inviteUser, mailLink, signIn, uniqueEmail } from './auth-helpers.ts';
import { expect, mapState, SIGNED_OUT, SUPER_ADMIN, test } from './fixtures.ts';

const SHOTS = new URL('../docs/features/f02-authentication/screenshots/', import.meta.url).pathname;
const EXPIRED_NOTICE = 'Your session has expired. Please sign in again.';

// Every F02 spec starts signed out in its own context, so signing out never ends the shared
// super-admin session of the other specs.
test.use({ storageState: SIGNED_OUT });

const loginHeading = (page: Page) => page.getByRole('heading', { name: 'Sign in' });

test('F02-T5: sign in lands on the requested page and the map loads; /login does no live work', async ({
  page,
}) => {
  let sockets = 0;
  let workers = 0;
  const tiles: string[] = [];
  // Live WS only (Vite's HMR socket is always there in dev).
  page.on('websocket', (ws) => {
    if (ws.url().includes('/ws/live')) sockets++;
  });
  page.on('worker', () => workers++);
  page.on('request', (r) => {
    if (/map-styles|tiles|\.pbf/.test(r.url())) tiles.push(r.url());
  });

  await page.goto('/live-tracking?view=table');
  await expect(page).toHaveURL(/\/login\?redirect=%2Flive-tracking%3Fview%3Dtable$/);
  await expect(loginHeading(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect({ sockets, workers, tiles }).toEqual({ sockets: 0, workers: 0, tiles: [] });

  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await expect(page).toHaveURL(/\/live-tracking\?view=table$/);
  await expect(page.getByRole('columnheader').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  await expect
    .poll(async () => (await mapState(page))?.frameVersion ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(sockets).toBeGreaterThan(0);
});

test('F02-T6: bad password → generic error; signed-out /admin → /login?redirect=%2Fadmin', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page, SUPER_ADMIN.email, 'wrong-password-1');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, 'nobody@fms.local', 'whatever1');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin$/);
  await expect(loginHeading(page)).toBeVisible();
});

test('F02-T7: forgot → mail → reset → sign in with the new password; the link is single-use', async ({
  page,
  baseURL,
}) => {
  const admin = await adminApi(baseURL!);
  const email = await createUser(baseURL!, admin, 'OldPass123');

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText(`If an account exists for ${email}`);

  const link = await mailLink(admin, email, 'reset-password');
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('NewPass456');
  await page.getByLabel('Confirm password').fill('NewPass456');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toHaveText(
    'Password updated. Sign in with your new password.',
  );
  await signIn(page, email, 'OldPass123');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await signIn(page, email, 'NewPass456');
  await expect(page).toHaveURL(/\/live-tracking$/);

  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('Another789');
  await page.getByLabel('Confirm password').fill('Another789');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This reset link has expired or was already used.',
  );
  await admin.dispose();
});

test('F02-T8: invite → accept → signed in → sign out → sign in with the new account', async ({
  page,
  baseURL,
}) => {
  const admin = await adminApi(baseURL!);
  const email = uniqueEmail('invite');
  const link = await inviteUser(admin, email);
  await admin.dispose();

  await page.goto(link);
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Name').fill('Invited Person');
  await page.getByLabel('New password', { exact: true }).fill('Invited123');
  await page.getByLabel('Confirm password').fill('Invited123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/live-tracking$/);

  await page.getByRole('button', { name: 'Account: Invited Person' }).click();
  const menu = page.getByRole('dialog', { name: 'Account' });
  await expect(menu).toContainText(email);
  await expect(menu).toContainText('Operator');
  await menu.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, email, 'Invited123');
  await expect(page).toHaveURL(/\/live-tracking$/);
  await expect(page.getByRole('button', { name: 'Account: Invited Person' })).toBeVisible();
});

test('F02-T9: sign out closes the WS and back shows no live data; a lost cookie → expiry notice', async ({
  page,
  context,
}) => {
  // The live WS lives in the worker, which closes itself after `dispose()`; either the socket
  // reports its close or the worker is gone (a closed worker takes its socket with it).
  const live: {
    ws: import('@playwright/test').WebSocket[];
    workers: Set<string>;
    closed: Set<string>;
  } = { ws: [], workers: new Set(), closed: new Set() };
  page.on('websocket', (ws) => {
    if (ws.url().includes('/ws/live')) live.ws.push(ws);
  });
  page.on('worker', (w) => {
    if (!w.url().includes('live-tracking-worker')) return;
    live.workers.add(w.url() + live.workers.size);
    const id = w.url() + (live.workers.size - 1);
    w.on('close', () => live.closed.add(id));
  });
  const liveStopped = () =>
    live.ws.every((ws) => ws.isClosed()) || live.closed.size === live.workers.size;
  await page.goto('/login');
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  expect(live.ws.length).toBeGreaterThan(0);
  expect(live.workers.size).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Account: Super Admin' }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(liveStopped).toBe(true);
  await page.goBack();
  await expect(loginHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('live-connection')).toHaveCount(0);

  // Session cookie deleted mid-session: the next API call (a row click fetches the trail) → 401.
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Table view' }).click();
  const row = page.locator('[role=row][data-vehicle-id]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await context.clearCookies();
  await row.click();
  await expect(page.getByRole('status').filter({ hasText: EXPIRED_NOTICE })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?redirect=%2Flive-tracking/);
  await expect.poll(liveStopped).toBe(true);
});

test.describe('F02-T11: UAT screenshots', () => {
  test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

  test('desktop screens and states', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await page.getByLabel('Email').fill('');
    await page.getByLabel('Email').blur();
    await page.screenshot({ path: `${SHOTS}sign-in.png` });
    await signIn(page, SUPER_ADMIN.email, 'wrong-password-1');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}sign-in-error.png` });

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('ops@fms.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}forgot-confirmation.png` });

    await page.goto('/reset-password?token=screenshot');
    await page.getByLabel('New password', { exact: true }).fill('abcdef1');
    await page.getByLabel('Confirm password').fill('abcdef12');
    await page.getByLabel('New password', { exact: true }).focus();
    await page.screenshot({ path: `${SHOTS}reset-rules.png` });

    await page.goto('/reset-password');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}reset-expired.png` });

    const admin = await adminApi(baseURL!);
    const link = await inviteUser(admin, uniqueEmail('shot'));
    await admin.dispose();
    await page.goto(link);
    await page.getByLabel('Name').fill('Asha Verma');
    await page.getByLabel('New password', { exact: true }).fill('Fleet2026');
    await page.screenshot({ path: `${SHOTS}accept-invite.png` });

    await page.goto('/accept-invite?token=nope');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}invite-expired.png` });

    await page.goto('/login');
    await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
    await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Account: Super Admin' }).click();
    await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}user-menu.png` });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('sign in and the drawer user menu', async ({ page }) => {
      await page.goto('/login');
      await page.screenshot({ path: `${SHOTS}mobile-sign-in.png` });
      await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
      await expect(page).toHaveURL(/\/live-tracking$/);
      await page.getByRole('button', { name: 'Open menu' }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('region', { name: 'Account' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}mobile-user-menu.png` });
      await drawer.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
