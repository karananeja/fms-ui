import { signIn } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/** F30: Settings → AI usage (own view, Organisation tab, CSV export). */

test.describe('F30 AI usage', () => {
  test('super admin: tiles, chart, tables, Organisation tab and CSV export', async ({ page }) => {
    await page.goto('/settings/usage');
    await expect(page.getByRole('heading', { name: 'AI usage' })).toBeVisible();
    for (const id of ['in', 'out', 'cache', 'cost'])
      await expect(page.getByTestId(`usage-tile-${id}`)).toBeVisible();
    await expect(page.getByTestId('usage-tile-cost')).toContainText('estimate');
    await expect(page.getByTestId('day-chart')).toBeVisible();
    await expect(page.getByRole('region', { name: 'By chat' })).toContainText('Ask FMS');
    await expect(page.getByTestId('usage-footnote')).toContainText('estimates');

    await page
      .getByRole('group', { name: 'Range' })
      .getByRole('button', { name: '7 days' })
      .click();
    await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Organisation' }).click();
    await expect(page.getByRole('region', { name: 'By user' })).toBeVisible();
    // The filters and Export CSV share one baseline and height.
    const boxes = await Promise.all(
      [page.locator('#usage-user'), page.locator('#usage-provider'), page.getByTestId('usage-export')].map(
        (l) => l.boundingBox(),
      ),
    );
    for (const b of boxes) {
      expect(Math.abs(b!.y + b!.height - (boxes[0]!.y + boxes[0]!.height))).toBeLessThanOrEqual(1);
      expect(Math.abs(b!.height - boxes[0]!.height)).toBeLessThanOrEqual(1);
    }
    await shot(page, { path: 'docs/features/f30-token-usage-monitor/screenshots/f30-org-tab.png' });
    const download = page.waitForEvent('download');
    await page.getByTestId('usage-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('ai-usage-7d.csv');
    const stream = await file.createReadStream();
    let text = '';
    for await (const chunk of stream) text += String(chunk);
    expect(text.split('\n')[0]).toMatch(/^at_ist,user_email,chat,/);
  });

  test.describe('without roles.manage', () => {
    test.use({ storageState: SIGNED_OUT });

    test('ops sees own usage, no Organisation tab', async ({ page }) => {
      await page.goto('/login');
      await signIn(page, 'ops@fms.local', 'Ops@1234');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      await page.goto('/settings/usage');
      await expect(page.getByRole('heading', { name: 'AI usage' })).toBeVisible();
      await expect(page.getByTestId('usage-tiles')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Organisation' })).toHaveCount(0);
    });
  });
});
