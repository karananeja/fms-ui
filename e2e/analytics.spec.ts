import type { AnalyticsSummary } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

const SHOTS = 'docs/features/f16-performance-dashboard/screenshots';
const VIEWER = { email: 'viewer@fms.local', password: 'View@1234' };

const tileValue = async (page: Page, id: string) =>
  Number(await page.getByTestId(`tile-${id}`).getAttribute('data-value'));

test('F16-T3: tiles match the API; range and tab live in the URL; vehicle drill-down → live map', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/analytics');
  await expect(page.getByTestId('kpi-tiles')).toBeVisible({ timeout: 20_000 });
  const shown = await tileValue(page, 'distance');
  const api = (await (await page.request.get('/api/analytics/summary')).json()) as AnalyticsSummary;
  // The page's 30-day window ends at page load; the API default ends now: within 1 %.
  expect(Math.abs(shown - api.kpis.distanceKm) / api.kpis.distanceKm).toBeLessThan(0.01);
  await page.screenshot({ path: `${SHOTS}/vehicles-tab.png`, fullPage: true });

  await page.getByRole('button', { name: '7 d' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect.poll(() => tileValue(page, 'distance')).toBeLessThan(shown);

  await page.getByTestId('ranking-row').first().click();
  await expect(page.getByTestId('drilldown')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/drilldown-vehicle.png` });
  await page.getByTestId('drilldown-live-link').click();
  await expect(page).toHaveURL(/\/live-tracking\?vehicle=/);
});

test('F16-T4: drivers ranking by score; driver drill-down; CSV export', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/analytics?tab=drivers&range=7d');
  const rows = page.getByTestId('ranking-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const scores = await rows.evaluateAll((trs) =>
    trs.map((tr) =>
      Number(
        (
          (tr as unknown as { children: { textContent: string | null }[] }).children[2]
            ?.textContent ?? ''
        ).replace(/,/g, ''),
      ),
    ),
  );
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  await page.screenshot({ path: `${SHOTS}/drivers-tab.png`, fullPage: true });

  await rows.first().click();
  await expect(page.getByTestId('drilldown')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Vehicles driven')).toBeVisible();
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^fleet-analytics-drivers-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
  );
});

test.describe('F16-T5: permissions', () => {
  test.use({ storageState: SIGNED_OUT });
  test('a Viewer has no Analytics', async ({ page }) => {
    expect((await page.request.post('/api/auth/login', { data: VIEWER })).ok()).toBe(true);
    await page.goto('/live-tracking');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Analytics' })).toHaveCount(
      0,
    );
    expect((await page.request.get('/api/analytics/summary')).status()).toBe(403);
  });
});

test('F16-T7: mobile screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/analytics?range=7d');
  await expect(page.getByTestId('kpi-tiles')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/mobile.png`, fullPage: true });
});
