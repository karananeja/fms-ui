import { adminApi, createUser } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

/**
 * User-reported layout bugs (2026-10-16): the window must never scroll past the app shell on a
 * dashboard, and the driver performance drill-down must not scroll sideways.
 */

test.describe('layout overflow', () => {
  test.use({ storageState: SIGNED_OUT });

  test('dashboard: the window never scrolls past the app shell', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const admin = await adminApi(baseURL!);
    const email = await createUser(baseURL!, admin, 'Dash1234!x');
    await admin.dispose();
    await page.request.post('/api/auth/login', { data: { email, password: 'Dash1234!x' } });
    const widgets = Array.from({ length: 8 }, (_, i) => ({
      type: 'daily-chart',
      title: `Distance ${i + 1}`,
      chart: 'bar',
      metrics: ['distanceKm'],
      range: '7d',
    }));
    const res = await page.request.post('/api/dashboards', { data: { title: 'Tall', widgets } });
    const { id } = (await res.json()) as { id: string };

    await page.goto(`/dashboards/${id}`);
    await expect(page.locator('.react-grid-item').first()).toBeVisible({ timeout: 20_000 });
    // Let charts load and the idle snapshot capture (D-142) run.
    await page.waitForTimeout(6000);
    // Worst case: something taller than the window lands in <body> and the window is asked to scroll.
    const scrolled = await page.evaluate(() => {
      const stray = document.createElement('div');
      stray.style.height = '3000px';
      document.body.appendChild(stray);
      window.scrollTo(0, 1000);
      document.querySelector('[data-testid=widget]:last-of-type')?.scrollIntoView();
      const y = window.scrollY;
      stray.remove();
      return y;
    });
    expect(scrolled).toBe(0);
    // The grid area itself still scrolls to the last widget.
    const grid = page.getByTestId('dashboard-scroll');
    await grid.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.locator('.react-grid-item').last()).toBeInViewport();
  });
});

// Signed in as the seeded super admin (the default storage state).
for (const size of [
  { name: 'desktop side panel', width: 1440, height: 900 },
  { name: 'phone sheet', width: 390, height: 844 },
]) {
  test(`driver performance drill-down never scrolls sideways (${size.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/analytics?tab=drivers&range=7d');
    await page.getByTestId('ranking-row').first().click({ timeout: 60_000 });
    const sheet = page.getByTestId('drilldown');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(sheet.getByTestId('day-chart').first()).toBeVisible();
    // The panel's scroll area (the drill-down's parent) must not be wider than itself: before the
    // fix, the charts' screen-reader tables made it 666 px wide in a 418 px panel.
    const widths = await sheet.evaluate((el) => {
      const area = el.parentElement!;
      return { scroll: area.scrollWidth, client: area.clientWidth };
    });
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });
}
