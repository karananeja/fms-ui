import { vehicleListSchema, type VehicleMeta } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, mapPoints, mapState, settled, test } from './fixtures.ts';

// TODO(F07 design revision): panel layout is being redesigned; re-enable once the spec is revised.
test.skip(true, 'F07 panel design under revision');

/** Minimal DOM typing for `page.evaluate` callbacks (the e2e tsconfig has no DOM lib). */
type Doc = {
  elementFromPoint(
    x: number,
    y: number,
  ): { classList: { contains(c: string): boolean }; closest(s: string): unknown } | null;
};

const panel = (page: Page) => page.getByRole('region', { name: 'Vehicle details' });

async function vehicles(page: Page, limit = 20): Promise<VehicleMeta[]> {
  const res = await page.request.get(`/api/vehicles?limit=${limit}`);
  return vehicleListSchema.parse(await res.json()).items;
}

/** Selects vehicles through the debug picker (→ store → URL → panel) until one has a wanted status. */
async function pickVehicle(page: Page, statuses: string[]): Promise<VehicleMeta> {
  await page.goto('/live-tracking?debug=1');
  for (const v of await vehicles(page)) {
    await page.getByLabel('Select vehicle').fill(v.vehicleId);
    await page.getByRole('button', { name: 'Select' }).click();
    await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno, { timeout: 15_000 });
    const pill = panel(page).getByTestId('details-status').locator('[data-status]');
    await expect(pill).toBeVisible();
    if (statuses.includes((await pill.getAttribute('data-status'))!)) {
      await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
      return v;
    }
  }
  throw new Error(`no vehicle with status ${statuses.join('/')} among the first 20`);
}

async function locateTo16(page: Page) {
  await panel(page).getByRole('button', { name: 'Locate on map' }).click();
  await expect
    .poll(async () => Math.abs(((await mapState(page))?.zoom ?? 0) - 16), { timeout: 10_000 })
    .toBeLessThan(0.05);
  return settled(page);
}

const vehicleParam = (id: string) => new RegExp(`[?&]vehicle=${id}(&|$)`);

test('F07-T6: point click opens; URL sync with reload, Esc, close, back; empty map click closes', async ({
  page,
}) => {
  const v = await pickVehicle(page, ['stopped', 'charging']);
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));

  await page.reload();
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
  await locateTo16(page);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/vehicle=/);
  await page.goBack();
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno);
  await panel(page).getByRole('button', { name: 'Close details' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/vehicle=/);

  const point = (await mapPoints(page, 5000)).find((p) => p.id === v.vehicleId);
  expect(point).toBeDefined();
  await page.mouse.click(point!.x, point!.y);
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno);
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));

  // A drag is not a click: the panel stays open.
  const box = (await page.getByTestId('live-map').boundingBox())!;
  const x = box.x + 120;
  const y = box.y + box.height - 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y - 60, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  await expect(panel(page)).toBeVisible();

  // Click an empty spot of the map canvas (no point within 40 px, no marker on top).
  const points = await mapPoints(page, 5000);
  const empty = await page.evaluate(
    ({ box, points }) => {
      for (let y = box.y + 80; y < box.y + box.height - 80; y += 40) {
        for (let x = box.x + 40; x < box.x + box.width - 480; x += 40) {
          const hit = (globalThis as unknown as { document: Doc }).document.elementFromPoint(x, y);
          const clear = points.every((p) => Math.hypot(p.x - x, p.y - y) > 40);
          if (clear && hit?.classList.contains('maplibregl-canvas')) return { x, y };
        }
      }
      return null;
    },
    { box, points },
  );
  expect(empty).not.toBeNull();
  await page.mouse.click(empty!.x, empty!.y);
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/vehicle=/);
});

test('F07-T7: live GPS time updates in the open panel; locate flies to zoom 16', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await pickVehicle(page, ['running', 'stopped', 'charging']);
  const gps = panel(page).getByTestId('details-gps-time');
  await expect(gps).not.toHaveText('—');
  const before = await gps.textContent();
  await expect(gps).not.toHaveText(before!, { timeout: 20_000 });

  const at = await locateTo16(page);
  expect(at.zoom).toBeCloseTo(16, 1);
  expect(at.selectedVehicleId).not.toBeNull();
});

test('F07-T9: expanded view has both gauges and all 374 parameters; search narrows to 23', async ({
  page,
}) => {
  const [v] = await vehicles(page, 1);
  await page.goto(`/live-tracking?vehicle=${v!.vehicleId}`);
  const p = panel(page);
  await expect(p.getByTestId('details-param-count')).toHaveText('(374)', { timeout: 15_000 });
  await p.getByRole('button', { name: 'Expand view' }).click();
  await expect(p).toHaveAttribute('data-details-panel', 'expanded');
  await expect(p.getByRole('img', { name: 'Speed gauge' })).toBeVisible();
  await expect(p.getByRole('img', { name: 'Motor gauge' })).toBeVisible();
  const items = p.getByRole('list', { name: 'Parameters' }).getByRole('listitem');
  await expect(items).toHaveCount(374);
  await p.getByRole('searchbox', { name: 'Search parameters' }).fill('cell_voltage');
  await expect(items).toHaveCount(23);
  await expect(p.getByTestId('details-param-count')).toHaveText('(23)');
  await p.getByRole('button', { name: 'Collapse view' }).click();
  await expect(p).toHaveAttribute('data-details-panel', 'compact');
});

test.describe('F07-T8: phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('bottom sheet opens at 35 %, drags to 92 %, map stays visible above', async ({ page }) => {
    const [v] = await vehicles(page, 1);
    await page.goto(`/live-tracking?vehicle=${v!.vehicleId}`);
    const sheet = page.getByRole('dialog', { name: 'Vehicle details' });
    await expect(sheet.getByTestId('details-regno')).toHaveText(v!.regno, { timeout: 15_000 });
    await expect(sheet).toHaveAttribute('data-snap', '0.35');
    const h = page.viewportSize()!.height;
    await expect
      .poll(async () => (await sheet.boundingBox())!.y, { timeout: 5000 })
      .toBeCloseTo(h * 0.65, -1);

    const map = (await page.getByTestId('live-map').boundingBox())!;
    const mapAbove = (y: number) =>
      page.evaluate(
        (y) =>
          !!(globalThis as unknown as { document: Doc }).document
            .elementFromPoint(195, y)
            ?.closest('[data-testid="live-map"]'),
        y,
      );
    expect(await mapAbove((await sheet.boundingBox())!.y - 20)).toBe(true);

    const handle = sheet.locator('[data-slot="drawer-handle"]');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, h * 0.08, { steps: 20 });
    await page.mouse.up();
    await expect(sheet).toHaveAttribute('data-snap', '0.92');
    await expect
      .poll(async () => (await sheet.boundingBox())!.y, { timeout: 5000 })
      .toBeCloseTo(h * 0.08, -1);
    const top = (await sheet.boundingBox())!.y;
    expect(top).toBeGreaterThan(map.y);
    expect(await mapAbove((map.y + top) / 2)).toBe(true);
  });
});
