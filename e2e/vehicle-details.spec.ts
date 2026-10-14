import { vehicleListSchema, type VehicleMeta } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, mapPoints, mapState, settled, test } from './fixtures.ts';

const SHOTS = 'docs/features/f07-vehicle-details/screenshots';

/** Minimal DOM typing for `page.evaluate` callbacks (the e2e tsconfig has no DOM lib). */
type Doc = {
  elementFromPoint(
    x: number,
    y: number,
  ): { classList: { contains(c: string): boolean }; closest(s: string): unknown } | null;
};

const panel = (page: Page) => page.getByRole('region', { name: 'Vehicle details' });

/**
 * Lists vehicles once the worker's first snapshot is complete (opens the page first if needed):
 * the worker only selects vehicles it knows (D-033). Before F02 the dev auto sign-in made the
 * 401 → 200 poll below wait about that long; with the signed-in setup state it returns at once.
 */
async function vehicles(page: Page, limit = 20): Promise<VehicleMeta[]> {
  if (!page.url().includes('/live-tracking')) await page.goto('/live-tracking');
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (globalThis as { __fmsLive?: { snapshotCompleteAt: number } }).__fmsLive
              ?.snapshotCompleteAt ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const get = () => page.request.get(`/api/vehicles?limit=${limit}`);
  await expect.poll(async () => (await get()).status(), { timeout: 15_000 }).toBe(200);
  return vehicleListSchema.parse(await (await get()).json()).items;
}

/** Selects vehicles through the debug picker (→ store → URL → panel) until one has a wanted status. */
async function pickVehicle(page: Page, statuses: string[]): Promise<VehicleMeta> {
  await page.goto('/live-tracking?debug=1');
  for (const v of await vehicles(page, 40)) {
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
  throw new Error(`no vehicle with status ${statuses.join('/')} among the first 40`);
}

async function locateTo16(page: Page) {
  await panel(page).getByRole('button', { name: 'Locate on map' }).click();
  await expect
    .poll(async () => Math.abs(((await mapState(page))?.zoom ?? 0) - 16), { timeout: 10_000 })
    .toBeLessThan(0.05);
  return settled(page);
}

const vehicleParam = (id: string) => new RegExp(`[?&]vehicle=${id}(&|$)`);

const trailLength = async (page: Page) => (await mapState(page))?.trailLength ?? null;
const callout = (page: Page) => page.getByTestId('selected-callout');

test('F07-T8: point click opens with trail + callout; reload, Esc, close, back; empty map click closes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const v = await pickVehicle(page, ['running', 'stopped', 'charging']);
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));
  await expect.poll(() => trailLength(page), { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(callout(page)).toContainText(v.regno);

  await page.reload();
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
  await expect.poll(() => trailLength(page), { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(callout(page)).toBeVisible();
  await expect(page.getByTestId('heading-compass')).toBeVisible();
  await locateTo16(page);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/vehicle=/);
  await expect(callout(page)).toHaveCount(0);
  expect(await trailLength(page)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno);
  await panel(page).getByRole('button', { name: 'Close details' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/vehicle=/);

  await settled(page);
  const point = (await mapPoints(page, 5000)).find((p) => p.id === v.vehicleId);
  expect(point).toBeDefined();
  await page.mouse.click(point!.x, point!.y);
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno);
  await expect(page).toHaveURL(vehicleParam(v.vehicleId));
  await expect(callout(page)).toBeVisible();

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

  // Click an empty spot of the map canvas (no point within 40 px, no overlay on top).
  const points = await mapPoints(page, 5000);
  const empty = await page.evaluate(
    ({ box, points }) => {
      for (let y = box.y + 160; y < box.y + box.height - 80; y += 40) {
        for (let x = box.x + 40; x < box.x + box.width - 560; x += 40) {
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
  await expect(callout(page)).toHaveCount(0);
});

test('F07-T9: GPS time or session chart updates within 20 s; locate flies to zoom 16', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await pickVehicle(page, ['running', 'stopped', 'charging']);
  const gps = panel(page).getByTestId('details-gps-rel');
  await expect(gps).not.toHaveText('—');
  const state = async () =>
    `${await gps.getAttribute('data-abs')}|${
      (await panel(page)
        .getByTestId('session-chart')
        .getAttribute('data-points')
        .catch(() => null)) ?? 'collecting'
    }`;
  const before = await state();
  await expect.poll(state, { timeout: 20_000 }).not.toBe(before);

  const at = await locateTo16(page);
  expect(at.zoom).toBeCloseTo(16, 1);
  expect(at.selectedVehicleId).not.toBeNull();
});

test('F07-T11: UAT screenshots (desktop tabs, map extras)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const v = await pickVehicle(page, ['running']);
  await locateTo16(page);
  await expect.poll(() => trailLength(page), { timeout: 10_000 }).toBeGreaterThan(1);
  const p = panel(page);
  await expect(p.getByTestId('details-param-count')).toHaveText('374', { timeout: 15_000 });
  await page.waitForTimeout(6000); // let the session chart collect a few samples
  await page.screenshot({ path: `${SHOTS}/desktop-overview.png` });
  await page.screenshot({ path: `${SHOTS}/map-trail-callout-compass.png` });
  for (const name of ['Parameters', 'Device', 'Events']) {
    await p.getByRole('tab', { name: new RegExp(name) }).click();
    await page.screenshot({ path: `${SHOTS}/desktop-${name.toLowerCase()}.png` });
  }
  expect(v.regno).toBeTruthy();
});

test.describe('F07-T10: phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sheet opens at 35 % (hero + rings), drags to 92 %; parameters 374 → 23, CELLS chip', async ({
    page,
  }) => {
    const [v] = await vehicles(page, 1);
    await page.goto(`/live-tracking?vehicle=${v!.vehicleId}`);
    const sheet = page.getByRole('dialog', { name: 'Vehicle details' });
    await expect(sheet.getByTestId('details-regno')).toHaveText(v!.regno, { timeout: 15_000 });
    await expect(sheet).toHaveAttribute('data-snap', '0.35');
    const h = page.viewportSize()!.height;
    await expect
      .poll(async () => (await sheet.boundingBox())!.y, { timeout: 5000 })
      .toBeCloseTo(h * 0.65, -1);
    await expect(sheet.getByTestId('ring-battery')).toBeInViewport();
    await expect(sheet.getByTestId('details-latest')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/mobile-sheet-35.png` });

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
    await page.screenshot({ path: `${SHOTS}/mobile-sheet-92.png` });

    await sheet.getByRole('tab', { name: /Parameters/ }).click();
    const rows = sheet.getByRole('table', { name: 'Parameters' }).getByRole('row');
    await expect(rows).toHaveCount(374);
    await sheet.getByRole('searchbox', { name: 'Search parameters' }).fill('cell_voltage');
    await expect(rows).toHaveCount(23);
    await sheet.getByRole('searchbox', { name: 'Search parameters' }).fill('');
    await sheet.getByRole('button', { name: 'CELLS' }).click();
    const keys = await rows.evaluateAll((els) =>
      els.map((e) => (e as unknown as { dataset: { pid: string } }).dataset.pid),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('cell_'))).toBe(true);
  });
});
