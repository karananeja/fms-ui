import type { Page } from '@playwright/test';
import { expect, mapState, settled, test, type Win } from './fixtures.ts';

/** The DOM bits used in `evaluate` (the e2e tsconfig has no DOM lib). */
interface Dom {
  getComputedStyle(el: unknown): { fontFamily: string };
  document: { fonts: Iterable<{ family: string }> };
}

// One worker for this file: each test streams a full snapshot, and parallel copies starve F06-T6.
test.describe.configure({ mode: 'serial' });

const SHOTS = 'docs/features/ds1-design-refresh/screenshots';

async function openFitted(page: Page, path = '/live-tracking') {
  await page.goto(path);
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  return settled(page);
}

const fontOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).fontFamily);

test('DS1-T2: body, buttons, inputs and map labels use Doto', async ({ page }) => {
  await openFitted(page, '/live-tracking?debug=1');
  for (const sel of [
    'body',
    'button',
    'input',
    '[data-testid="map-cluster"]',
    '.maplibregl-ctrl-attrib',
  ]) {
    expect(await fontOf(page, sel), sel).toMatch(/^"?Doto/);
  }
  const fonts = await page.evaluate(() =>
    [...(globalThis as unknown as Dom).document.fonts].map((f) => f.family),
  );
  expect(fonts.join()).not.toMatch(/Inter/);
});

test('DS1-R10/R11: LIVE pill shows the feed; 2D/3D pitches the map and is remembered', async ({
  page,
}) => {
  await openFitted(page);
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  await expect(page.getByTestId('live-rate')).toContainText('rows/s');
  const pitch = () => page.evaluate(() => (globalThis as unknown as Win).__fmsMap?.pitch ?? -1);
  expect(await pitch()).toBe(0);
  const toggle = page.getByRole('button', { name: '3D view' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(pitch, { timeout: 5_000 }).toBeCloseTo(55, 0);
  await page.screenshot({ path: `${SHOTS}/desktop-3d.png` });
  await openFitted(page);
  expect(await pitch()).toBeCloseTo(55, 0);
  await page.getByRole('button', { name: '3D view' }).click();
  await expect.poll(pitch, { timeout: 5_000 }).toBe(0);
});

test('DS1-T4: UAT screenshots (desktop clusters, zoom 15 + selection)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFitted(page);
  await expect(page.getByTestId('map-cluster').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/desktop-clusters.png` });

  await page.goto('/live-tracking?debug=1');
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  const list = (await (await page.request.get('/api/vehicles?limit=1')).json()) as {
    items: { vehicleId: string }[];
  };
  const id = list.items[0]?.vehicleId;
  expect(id).toBeTruthy();
  await page.getByLabel('Locate vehicle ID').fill(id!);
  await page.getByRole('button', { name: 'Locate' }).click();
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
  await expect.poll(async () => (await mapState(page))?.highlight).not.toBeNull();
  await expect
    .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
    .toBeCloseTo(16, 1);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect
    .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
    .toBeCloseTo(15, 1);
  await settled(page);
  await page.screenshot({ path: `${SHOTS}/desktop-zoom15-selection.png` });
});

test.describe('DS1-T4: phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('390 px screenshot', async ({ page }) => {
    await openFitted(page);
    await expect(page.getByRole('button', { name: '3D view' })).toBeHidden();
    await expect(page.getByTestId('map-cluster').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/mobile-390.png` });
  });
});
