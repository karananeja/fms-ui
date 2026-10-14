import { adminApi, createUser, inviteUser, mailLink, uniqueEmail } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

const MINUTE = 60_000;

// Pages run signed out: while the clock is shifted, nothing may touch the shared session.
test.use({ storageState: SIGNED_OUT });

test.afterEach(async ({ request }) => {
  await request.post('/api/dev/clock', { data: { offsetMs: 0 } });
});

test('F02-T10: a reset link after +31 minutes shows the expired state', async ({
  page,
  request,
  baseURL,
}) => {
  const admin = await adminApi(baseURL!);
  const email = await createUser(baseURL!, admin, 'OldPass123');
  expect((await admin.post('/api/auth/forgot-password', { data: { email } })).status()).toBe(202);
  const link = await mailLink(admin, email, 'reset-password');
  await admin.dispose();

  expect((await request.post('/api/dev/clock', { data: { offsetMs: 31 * MINUTE } })).ok()).toBe(
    true,
  );
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('NewPass456');
  await page.getByLabel('Confirm password').fill('NewPass456');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This reset link has expired or was already used.',
  );
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
});

test('F02-T10: an invite link after +7 days shows the expired state', async ({
  page,
  request,
  baseURL,
}) => {
  const admin = await adminApi(baseURL!);
  const link = await inviteUser(admin, uniqueEmail('clock'));
  await admin.dispose();

  const offsetMs = 7 * 24 * 60 * MINUTE + MINUTE;
  expect((await request.post('/api/dev/clock', { data: { offsetMs } })).ok()).toBe(true);
  await page.goto(link);
  await expect(page.getByRole('alert')).toHaveText(
    'This invite has expired or is no longer valid. Ask your administrator for a new invite.',
  );
});
