import { adminApi } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { createShare, LOCATION_ONLY, movingVehicle } from './share-public-helpers.ts';

// F10-T7 (D-038): shifts the shared mock clock past the link's expiry. The page is signed out.
test.use({ storageState: SIGNED_OUT });

test.afterEach(async ({ request }) => {
  await request.post('/api/dev/clock', { data: { offsetMs: 0 } });
});

test('F10-T7: past expiresAt the open page shows unavailable, and so does a reload', async ({
  page,
  request,
  baseURL,
}) => {
  const api = await adminApi(baseURL!);
  try {
    const link = await createShare(api, await movingVehicle(api), LOCATION_ONLY, 10 * 60_000);
    await page.goto(link.url);
    await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('share-expiry')).toContainText('in 9 min');

    // The server closes the share socket with 4410 on its next flush; no reload needed.
    expect((await request.post('/api/dev/clock', { data: { offsetMs: 11 * 60_000 } })).ok()).toBe(
      true,
    );
    await expect(page.getByTestId('share-unavailable')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: 'This link is no longer available' }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('share-unavailable')).toHaveAttribute('data-kind', 'gone');
    expect((await page.request.get(`/api/public/share/${link.token}`)).status()).toBe(410);
  } finally {
    await api.dispose();
  }
});
