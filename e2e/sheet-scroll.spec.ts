import type { Locator, Page } from '@playwright/test';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

/**
 * Sheets scroll to their end: wheel (and touch) over the sheet brings the last content fully into
 * the viewport, and the page behind does not scroll.
 */

const DRIVER = { email: 'driver@fms.local', password: 'Drive@1234' };
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 390, height: 560 },
  { width: 1280, height: 720 },
];

async function wheelOver(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
}

/** The element's whole box is on screen (not just inside its scroll container). */
async function expectOnScreen(page: Page, el: Locator, label?: string) {
  const box = (await el.boundingBox())!;
  const { height } = page.viewportSize()!;
  expect(box.y, label).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, label).toBeLessThanOrEqual(height + 1);
}

test.describe('vehicle details mobile sheet (vaul, 92 % snap)', () => {
  for (const viewport of VIEWPORTS.filter((v) => v.width < 1024)) {
    test(`content end is reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/live-tracking');
      const get = () => page.request.get('/api/vehicles?limit=1');
      await expect.poll(async () => (await get()).status(), { timeout: 15_000 }).toBe(200);
      const [v] = (
        (await (await get()).json()) as { items: { vehicleId: string; regno: string }[] }
      ).items;
      await page.goto(`/live-tracking?vehicle=${v!.vehicleId}`);
      const sheet = page.getByRole('dialog', { name: 'Vehicle details' });
      await expect(sheet.getByTestId('details-regno')).toHaveText(v!.regno, { timeout: 15_000 });
      const h = viewport.height;
      await expect
        .poll(async () => (await sheet.boundingBox())!.y, { timeout: 5000 })
        .toBeCloseTo(h * 0.65, -1);
      const hb = (await sheet.locator('[data-slot="drawer-handle"]').boundingBox())!;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, h * 0.08, { steps: 20 });
      await page.mouse.up();
      await expect(sheet).toHaveAttribute('data-snap', '0.92');
      await page.waitForTimeout(800);

      const tabs = (await sheet.getByRole('tablist').boundingBox())!;
      await wheelOver(page, tabs.x + tabs.width / 2, tabs.y + tabs.height + 80);
      // The last overview block (events / share) is fully on screen; before the fix its bottom
      // stayed (1 − 0.92) of the viewport below the fold.
      await expectOnScreen(page, sheet.getByRole('tabpanel').locator(':scope > *').last());
    });
  }
});

test.describe('admin driver panel and form', () => {
  for (const viewport of VIEWPORTS) {
    test(`scroll to the last button at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/admin/drivers');
      const check = async (label: string) => {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(600);
        const box = (await dialog.boundingBox())!;
        // Over the body's side padding, so a nested list (fleet picker) doesn't take the wheel.
        await wheelOver(page, box.x + 8, box.y + box.height / 2);
        await expectOnScreen(page, dialog.getByRole('button').last(), label);
      };
      await page.getByRole('row').nth(1).click();
      await check('view');
      const edit = page.getByRole('dialog').getByRole('button', { name: 'Edit' });
      if (await edit.count()) {
        await edit.first().click();
        await check('edit');
      }
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add driver' }).click();
      await check('add');
    });
  }
});

test.describe('driver report sheet', () => {
  test.use({ storageState: SIGNED_OUT });

  async function openReport(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DRIVER.email);
    await page.getByLabel('Password', { exact: true }).fill(DRIVER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/driver$/, { timeout: 15_000 });
    await expect(page.getByTestId('my-regno')).toBeVisible({ timeout: 10_000 });
    const cta = page.getByRole('button', { name: /Report a problem/ });
    test.skip(!(await cta.isVisible()), 'driver has an open incident');
    await cta.click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(600);
    await expectOnScreen(page, sheet, 'sheet fits the viewport');
    return sheet;
  }

  for (const viewport of VIEWPORTS) {
    test(`wheel reaches Next at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const sheet = await openReport(page);
      const box = (await sheet.boundingBox())!;
      const pageScroll = () => page.evaluate(() => (globalThis as { scrollY?: number }).scrollY);
      const before = await pageScroll();
      await wheelOver(page, box.x + box.width / 2, box.y + box.height / 2);
      await expectOnScreen(page, sheet.getByRole('button', { name: 'Next' }));
      expect(await pageScroll()).toBe(before);
    });
  }

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 560 } });

    test('swipe reaches Next', async ({ page }) => {
      const sheet = await openReport(page);
      const box = (await sheet.boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.synthesizeScrollGesture', {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        yDistance: -600,
        gestureSourceType: 'touch',
        repeatCount: 3,
        speed: 2000,
      });
      await cdp.detach();
      await page.waitForTimeout(300);
      await expectOnScreen(page, sheet.getByRole('button', { name: 'Next' }));
    });
  });
});
