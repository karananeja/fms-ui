import { adminApi, createUser } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/** F20 addendum (D-142) S-T9: the dashboard page captures the grid; the list card shows it. */

const PASSWORD = 'Snap1234!x';
const SHOTS = 'docs/features/f20-dashboards-ui/screenshots';

test.use({ storageState: SIGNED_OUT });

test('S-T9: a snapshot is captured on open and shown on the list card', async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const email = await createUser(baseURL!, admin, PASSWORD);
  await admin.dispose();
  expect((await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })).ok()).toBe(true);
  const res = await page.request.post('/api/dashboards', {
    data: {
      title: 'Snapshot board',
      widgets: [
        { type: 'text', title: 'Shift notes', body: 'Morning **handover** done' },
        { type: 'kpi', title: 'Distance', source: 'analytics', metric: 'distanceKm', range: '7d' },
      ],
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  const uploaded = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().includes(`/api/dashboards/${id}/snapshot`),
    { timeout: 30_000 },
  );
  await page.goto(`/dashboards/${id}`);
  await expect(page.getByTestId('widget')).toHaveCount(2);
  const req = await uploaded;
  expect(req.headers()['content-type']).toMatch(/^image\/(webp|png)$/);
  const bytes = req.postDataBuffer()!.length;
  expect(bytes).toBeLessThanOrEqual(120 * 1024);
  if (req.headers()['content-type'] === 'image/webp') expect(bytes).toBeLessThanOrEqual(40 * 1024);
  const saved = await req.response();
  expect(saved?.status()).toBe(200);

  await page.goto('/dashboards');
  const card = page.locator(`[data-testid="dashboard-card"][data-dashboard-id="${id}"]`);
  const img = card.getByTestId('card-snapshot-img');
  await expect(img).toBeVisible();
  await expect(card.getByTestId('card-snapshot-age')).toHaveText(/Snapshot · just now/);
  // Grid only, fixed 640×400 output (no chat dock or title bar in it).
  await expect
    .poll(() =>
      img.evaluate((el) => {
        const i = el as unknown as { naturalWidth: number; naturalHeight: number };
        return `${i.naturalWidth}x${i.naturalHeight}`;
      }),
    )
    .toBe('640x400');
  await card.hover();
  await shot(page, { path: `${SHOTS}/f20-snapshot-card.png` });

  // Opening it again within 10 min (same theme, unchanged) does not capture again.
  let puts = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/snapshot')) puts++;
  });
  await page.goto(`/dashboards/${id}`);
  await expect(page.getByTestId('widget')).toHaveCount(2);
  await page.waitForTimeout(5000);
  expect(puts).toBe(0);
});
