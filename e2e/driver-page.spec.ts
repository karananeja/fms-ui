import type { DriverRequest } from '@shared/contract/index.ts';
import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

const SHOTS = 'docs/features/f13-driver-web-page/screenshots';
const DRIVER = { email: 'driver@fms.local', password: 'Drive@1234' };

// Every test acts as the one seed driver (one open request per type), so they run in order.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: SIGNED_OUT, viewport: { width: 390, height: 844 } });

async function driverApi(baseURL: string): Promise<APIRequestContext> {
  const ctx = await apiRequest.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: DRIVER })).ok()).toBe(true);
  return ctx;
}

const act = (admin: APIRequestContext, id: string, data: Record<string, unknown>) =>
  admin.post(`/api/requests/${id}/actions`, { data });

/** Ends the seed driver's open requests so each test starts clean. */
async function closeOpen(baseURL: string) {
  const driver = await driverApi(baseURL);
  const admin = await adminApi(baseURL);
  const { openRequests } = (await (await driver.get('/api/driver/me')).json()) as {
    openRequests: DriverRequest[];
  };
  for (const r of openRequests) {
    if (r.type === 'replacement') await act(admin, r.id, { action: 'close' });
    else {
      await act(admin, r.id, { action: 'acknowledge' });
      if (r.type === 'rsa')
        await act(admin, r.id, { action: 'dispatch', assignee: 'X', etaMinutes: 5 });
      await act(admin, r.id, { action: 'resolve' });
    }
  }
  await driver.dispose();
  await admin.dispose();
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DRIVER.email);
  await page.getByLabel('Password', { exact: true }).fill(DRIVER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/driver$/, { timeout: 15_000 });
  await expect(page.getByTestId('my-regno')).toBeVisible({ timeout: 10_000 });
}

const incident = (page: Page) => page.getByTestId('incident-card').first();

/** Reports through the guided flow: reason → help (as suggested) → send. */
async function report(page: Page, reason: string, note = '') {
  await page.getByRole('button', { name: /Report a problem/ }).click();
  await page.getByText(reason, { exact: true }).click();
  if (note) await page.getByLabel(/Describe the problem/).fill(note);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled({ timeout: 15_000 });
}

test.beforeEach(async ({ baseURL }) => closeOpen(baseURL!));

test('F13-T2 / D-109: one report sends the breakdown and the suggested roadside help', async ({
  page,
}) => {
  await signIn(page);
  await page.screenshot({ path: `${SHOTS}/home-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: /Report a problem/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Choose what happened.')).toBeVisible();
  await page.getByText('Tyre', { exact: true }).click();
  await page.getByLabel(/Describe the problem/).fill('Front left puncture');
  await page.screenshot({ path: `${SHOTS}/report-step-1.png` });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('checkbox', { name: /Roadside help/ })).toBeChecked();
  await page.screenshot({ path: `${SHOTS}/report-step-2.png` });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.screenshot({ path: `${SHOTS}/report-step-3.png` });
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByTestId('report-item-rsa')).toHaveAttribute('data-state', 'sent', {
    timeout: 15_000,
  });
  await page.screenshot({ path: `${SHOTS}/report-sent.png` });
  await page.getByRole('button', { name: 'Done' }).click();

  const card = incident(page);
  await expect(card).toContainText('Tyre');
  await expect(card.getByTestId('part-breakdown')).toHaveAttribute('data-status', 'open');
  await expect(card.getByTestId('part-rsa')).toHaveAttribute('data-status', 'open');
  // An open problem replaces the report button; extra help can be added on the incident.
  await expect(page.getByTestId('open-incident-cta')).toBeVisible();
  await card.getByRole('button', { name: /Also need another vehicle/ }).click();
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByTestId('part-replacement')).toBeVisible({ timeout: 10_000 });
});

test('F13-T3: operator steps show live on the incident', async ({ page, baseURL }) => {
  await signIn(page);
  await report(page, 'Mechanical');
  await page.getByRole('button', { name: 'Done' }).click();
  const card = incident(page);
  const rsa = card.getByTestId('part-rsa');
  await expect(rsa).toHaveAttribute('data-status', 'open');
  const id = (await rsa.getAttribute('data-request-id'))!;

  const admin = await adminApi(baseURL!);
  expect((await act(admin, id, { action: 'acknowledge', note: 'On it' })).ok()).toBe(true);
  await expect(rsa).toHaveAttribute('data-status', 'acknowledged', { timeout: 5_000 });
  await expect(card).toContainText('On it');
  expect(
    (await act(admin, id, { action: 'dispatch', assignee: 'Suresh', etaMinutes: 30 })).ok(),
  ).toBe(true);
  await expect(card).toContainText('RSA dispatched: Suresh, ETA 30 min', { timeout: 5_000 });
  await expect(card.getByTestId('incident-summary')).toHaveText('Help on the way · ETA 30 min');
  await page.screenshot({ path: `${SHOTS}/incident-timeline.png`, fullPage: true });
  expect((await act(admin, id, { action: 'resolve' })).ok()).toBe(true);
  await expect(rsa).toHaveAttribute('data-status', 'resolved', { timeout: 5_000 });
  await admin.dispose();
});

test('F13-T4: an assigned replacement switches the vehicle and shows the banner', async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  const before = await page.getByTestId('my-regno').textContent();
  const driver = await driverApi(baseURL!);
  const created = await driver.post('/api/requests', { data: { type: 'replacement', note: '' } });
  expect(created.status()).toBe(201);
  const r = (await created.json()) as DriverRequest;
  await driver.dispose();

  const admin = await adminApi(baseURL!);
  await expect
    .poll(
      async () =>
        ((await (await admin.get(`/api/requests/${r.id}`)).json()) as DriverRequest).status,
    )
    .toBe('suggested');
  expect((await act(admin, r.id, { action: 'approve' })).ok()).toBe(true);
  await admin.dispose();

  await expect(page.getByTestId('replacement-banner')).toContainText('Replacement assigned:', {
    timeout: 5_000,
  });
  const after = await page.getByTestId('my-regno').textContent();
  expect(after).not.toBe(before);
  await expect(page.getByTestId('replacement-banner')).toContainText(after!);
  await page.screenshot({ path: `${SHOTS}/replacement-banner.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${SHOTS}/home-desktop.png` });
});

test('F13-T5: Driver is sent to /driver; staff gets No access on /driver', async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  for (const path of ['/live-tracking', '/admin']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/driver$/, { timeout: 10_000 });
  }
  const staff = await browser.newContext({ baseURL });
  const admin = await staff.newPage();
  expect(
    (
      await admin.request.post('/api/auth/login', {
        data: { email: 'superadmin@fms.local', password: 'Admin@123' },
      })
    ).ok(),
  ).toBe(true);
  await admin.goto('/driver');
  await expect(admin.getByRole('heading', { name: 'No access' })).toBeVisible();
  await staff.close();
});
