import { vehicleListSchema } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, mapPoints, mapState, metres, settled, test } from './fixtures.ts';

const INDIA_CENTER: [number, number] = [82.75, 21.1];
/** `india-cities.ts` Pune box. */
const PUNE = { w: 73.6489, s: 18.3228, e: 74.0645, n: 18.718 };

/** Opens the map and waits (bounded) for the one auto-fit after the snapshot. */
async function openFitted(page: Page, path = '/live-tracking') {
  await page.goto(path);
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  return settled(page);
}

const inPune = ([lng, lat]: [number, number]) =>
  lng > PUNE.w && lng < PUNE.e && lat > PUNE.s && lat < PUNE.n;

/** Polls (bounded) until the camera satisfies `check`, then waits for it to settle. */
async function camera(
  page: Page,
  check: (m: { center: [number, number]; zoom: number }) => boolean,
) {
  await expect
    .poll(
      async () => {
        const m = await mapState(page);
        return !!m && check(m);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return settled(page);
}

/** First listed vehicle whose derived status keeps it in place (via the debug picker). */
async function stationaryVehicle(page: Page): Promise<string> {
  const list = vehicleListSchema.parse(
    await (await page.request.get('/api/vehicles?limit=20')).json(),
  );
  for (const v of list.items) {
    await page.getByLabel('Select vehicle').fill(v.vehicleId);
    await page.getByRole('button', { name: 'Select' }).click();
    await expect(page.getByTestId('live-selected')).toContainText(v.regno);
    const status = await page
      .getByTestId('live-selected-status')
      .locator('[data-status]')
      .getAttribute('data-status');
    if (status === 'stopped' || status === 'charging' || status === 'non-comm') return v.vehicleId;
  }
  throw new Error('no stationary vehicle among the first 20');
}

async function drag(page: Page, dx: number, dy: number) {
  const box = (await page.getByTestId('live-map').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('F06-T6: India view first, one auto-fit after the snapshot, no re-fit later', async ({
  page,
}) => {
  await page.goto('/live-tracking');
  await expect.poll(() => mapState(page)).not.toBeNull();
  const initial = (await mapState(page))!;
  expect(metres(initial.center, INDIA_CENTER)).toBeLessThan(150_000);
  expect(initial.zoom).toBeLessThan(6);

  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  const fitted = await settled(page);
  expect(fitted.clusterCount + fitted.pointCount).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');

  await drag(page, -250, 120);
  const moved = await settled(page);
  expect(metres(moved.center, fitted.center)).toBeGreaterThan(50_000);
  await page.waitForTimeout(5000);
  const later = (await mapState(page))!;
  expect(later.center).toEqual(moved.center);
  expect(later.zoom).toBe(moved.zoom);
});

test('F06-T7: zoom-to-fit refits; the city dropdown jumps to Pune', async ({ page }) => {
  const fitted = await openFitted(page);

  await page.getByRole('button', { name: 'Jump to city…' }).click();
  await page.getByRole('textbox', { name: 'Search city' }).fill('pun');
  await page.getByRole('option', { name: /Pune/ }).getByRole('button').click();
  const pune = await camera(page, (m) => m.zoom > fitted.zoom + 3);
  expect(inPune(pune.center)).toBe(true);
  await expect(page.getByRole('button', { name: 'Jump to city…' })).toBeVisible();

  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  const refit = await camera(page, (m) => m.zoom < pune.zoom - 3);
  expect(Math.abs(refit.zoom - fitted.zoom)).toBeLessThan(0.25);
  expect(metres(refit.center, fitted.center)).toBeLessThan(50_000);
});

test('F06-T8: cluster click zooms in; point click selects; debug locate flies to zoom 16', async ({
  page,
}) => {
  const fitted = await openFitted(page, '/live-tracking?debug=1');
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();

  const cluster = page.getByTestId('map-cluster').first();
  await cluster.click();
  const zoomed = await camera(page, (m) => m.zoom > fitted.zoom + 0.5);
  expect(zoomed.zoom).toBeGreaterThan(fitted.zoom);

  // A stationary vehicle, so "≤ 100 m from the vehicle" doesn't race its ~10 s reports.
  await page.getByRole('button', { name: 'Expand diagnostics' }).click();
  const vehicleId = await stationaryVehicle(page);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Locate vehicle ID').fill(vehicleId);
  await page.getByRole('button', { name: 'Locate' }).click();
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
  await expect.poll(async () => (await mapState(page))?.selectedVehicleId).toBe(vehicleId);
  const located = await camera(page, (m) => Math.abs(m.zoom - 16) < 0.05);
  expect(located.zoom).toBeCloseTo(16, 1);
  await expect.poll(async () => (await mapState(page))?.highlight).not.toBeNull();
  const at = (await mapState(page))!;
  expect(metres(at.center, at.highlight!)).toBeLessThanOrEqual(100);

  // Deselect, then click the vehicle's point: it is selected again and gets the ring.
  await page.getByRole('button', { name: 'Expand diagnostics' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
  await expect.poll(async () => (await mapState(page))?.highlight).toBeNull();
  const point = (await mapPoints(page, 5000)).find((p) => p.id === vehicleId)!;
  expect(point).toBeDefined();
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await mapState(page))?.selectedVehicleId).toBe(vehicleId);
  await expect
    .poll(async () => {
      const h = (await mapState(page))?.highlight;
      return h ? metres(h, [point.lng, point.lat]) : Infinity;
    })
    .toBeLessThan(100);
});

test('F06-R19: locating a vehicle without a position shows a toast', async ({ page }) => {
  await openFitted(page, '/live-tracking?debug=1');
  await page.getByLabel('Locate vehicle ID').fill('no-such-vehicle');
  await page.getByRole('button', { name: 'Locate' }).click();
  await expect(page.getByRole('status')).toHaveText('No location available');
});

test.describe('F06-T10: phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('map, toolbar and attribution are visible and usable at 390 px', async ({ page }) => {
    const fitted = await openFitted(page);
    const map = page.getByTestId('live-map');
    await expect(map).toBeVisible();
    const mapBox = (await map.boundingBox())!;
    expect(mapBox.width).toBeGreaterThan(380);
    const attribution = page.locator('.maplibregl-ctrl-attrib');
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText('OpenStreetMap');
    await expect(attribution).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeInViewport();

    const fit = page.getByRole('button', { name: 'Zoom to fit' });
    const city = page.getByRole('button', { name: 'Jump to city…' });
    await expect(fit).toBeInViewport();
    await expect(city).toBeInViewport();
    await city.click();
    await page.getByRole('option', { name: /Pune/ }).getByRole('button').click();
    const pune = await camera(page, (m) => m.zoom > fitted.zoom + 3);
    expect(inPune(pune.center)).toBe(true);
    await fit.click();
    const refit = await camera(page, (m) => m.zoom < pune.zoom - 3);
    expect(metres(refit.center, fitted.center)).toBeLessThan(50_000);
  });
});
