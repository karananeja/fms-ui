import { fleetListSchema, vehicleListSchema } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, mapState, settled, test } from './fixtures.ts';

const SHOTS = 'docs/features/f08-status-bar-search-filters/screenshots';

/** Opens the map and waits (bounded) for the one auto-fit after the snapshot. */
async function openFitted(page: Page) {
  await page.goto('/live-tracking');
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  return settled(page);
}

/** All pill counts in one read (one render), from their accessible names. */
const pillCounts = async (page: Page) => {
  // The hidden measuring row holds every pill, including those collapsed into +N.
  const pairs = await page
    .locator('[data-slot="map-status-chips"] div[aria-hidden] > button[data-status]')
    .evaluateAll((els) =>
      els.map((el) => {
        const b = el as unknown as { getAttribute(name: string): string | null };
        return [b.getAttribute('data-status'), b.getAttribute('aria-label')];
      }),
    );
  return Object.fromEntries(
    pairs.map(([status, label]) => [status!, Number(label!.split(': ')[1]!.replace(/,/g, ''))]),
  ) as Record<string, number>;
};

const allCount = async (page: Page) => (await pillCounts(page)).all!;

/** Clicks a status pill, through the `+N` overflow when it doesn't fit the row. */
async function clickPill(page: Page, label: string) {
  const row = page.locator('[data-slot="map-status-chips"] > button', { hasText: label });
  if (await row.count()) return row.click();
  await page.getByRole('button', { name: /more statuses$/ }).click();
  await page
    .getByRole('dialog', { name: 'More statuses' })
    .getByRole('button', { name: new RegExp(`^${label}: `) })
    .click();
  await page.keyboard.press('Escape');
}

test('F08-T7: suggestions, locate at zoom 16, Enter filters by prefix', async ({ page }) => {
  await openFitted(page);
  const total = (await mapState(page))!.vehicleCount;
  const { items } = vehicleListSchema.parse(
    await (await page.request.get('/api/vehicles?limit=5')).json(),
  );
  const v = items[0]!;
  const box = page.getByRole('combobox', { name: 'Search vehicles' });
  await box.fill(v.regno);
  const list = page.getByRole('listbox', { name: 'Vehicle suggestions' });
  await expect(list.getByRole('option').first()).toBeVisible();
  await list.getByRole('option').filter({ hasText: v.regno }).first().click();
  await expect.poll(async () => (await mapState(page))?.selectedVehicleId).toBe(v.vehicleId);
  await expect
    .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
    .toBeCloseTo(16, 0);
  await page.keyboard.press('Escape'); // close the details panel
  await expect.poll(async () => (await mapState(page))?.selectedVehicleId).toBeNull();

  // Back out to the whole fleet, then filter by the regno's first characters.
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  const before = await settled(page);
  const prefix = v.regno.slice(0, 6);
  // Keep the pointer off the list: hovering highlights a suggestion, and Enter would pick it.
  await page.mouse.move(700, 600);
  await box.fill(prefix);
  await expect(list).toBeVisible();
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
    `Any: ${prefix.toUpperCase()}…`,
  );
  await expect.poll(() => allCount(page)).toBeLessThan(total);
  await expect.poll(() => allCount(page)).toBeGreaterThan(0);
  const after = await settled(page, before.frameVersion);
  expect(after.framed).toBeLessThan(before.framed);
});

test('F08-T8: RUNNING + CHARGING sum to ALL, fit fits them, Clear all restores', async ({
  page,
}) => {
  await openFitted(page);
  const total = (await mapState(page))!.vehicleCount;
  await expect.poll(() => allCount(page)).toBe(total);
  await clickPill(page, 'Running');
  await clickPill(page, 'Charging');
  await expect
    .poll(async () => {
      const c = await pillCounts(page);
      return c.running! + c.charging! === c.all && c.all < total;
    })
    .toBe(true);

  const before = (await mapState(page))!;
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  const fitted = await settled(page, before.frameVersion);
  // Every filtered vehicle (all have a fix) is inside the fitted view. Statuses change live
  // between the frame and the count read, so allow 2 % either way.
  const filtered = await allCount(page);
  expect(Math.abs(fitted.framed - filtered)).toBeLessThanOrEqual(Math.ceil(filtered * 0.02));

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect.poll(() => allCount(page)).toBe(total);
  await expect(page.getByRole('list', { name: 'Active filters' })).toHaveCount(0);
});

test('F08-T9: fleet + SOC range from the panel drop the counts and show chips', async ({
  page,
}) => {
  await openFitted(page);
  const total = (await mapState(page))!.vehicleCount;
  const fleets = fleetListSchema.parse(await (await page.request.get('/api/fleets')).json());
  // A fleet holding part of the scope (not the root of everything).
  const fleet = fleets.find((f) => f.vehicleCount > 0 && f.vehicleCount < total) ?? fleets[0]!;

  await page.getByRole('button', { name: 'Filters' }).click();
  const panel = page.getByRole('form', { name: 'Vehicle filters' });
  await panel.getByLabel('Search fleets').fill(fleet.name);
  await panel.getByRole('treeitem').filter({ hasText: fleet.name }).last().locator('label').click();
  const min = panel.getByRole('slider', { name: 'Minimum SOC' });
  await min.focus();
  for (let k = 0; k < 2; k++) await min.press('PageUp'); // +10 each
  const max = panel.getByRole('slider', { name: 'Maximum SOC' });
  await max.focus();
  for (let k = 0; k < 4; k++) await max.press('PageDown');
  await expect(panel).toContainText('SOC 20–60%');
  await page.screenshot({ path: `${SHOTS}/filter-panel.png` });
  await panel.getByRole('button', { name: 'Apply' }).click();

  const chips = page.getByRole('list', { name: 'Active filters' });
  await expect(chips).toContainText(`Fleet: ${fleet.name}`);
  await expect(chips).toContainText('SOC 20–60%');
  await expect.poll(() => allCount(page)).toBeLessThan(total);
  await expect(page.getByRole('button', { name: /^Filters \(2 active\)$/ })).toBeVisible();
  await expect(page.getByTestId('pulse-scope')).toHaveText(fleet.name, { ignoreCase: true });
  await page.screenshot({ path: `${SHOTS}/active-chips.png` });
});

test('F08-T10: top bar with suggestions + fleet pulse screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFitted(page);
  const { items } = vehicleListSchema.parse(
    await (await page.request.get('/api/vehicles?limit=1')).json(),
  );
  // Two pulse samples (10 s apart) so the sparkline is real data, not a placeholder.
  await expect(page.getByTestId('pulse-collecting')).toBeHidden({ timeout: 25_000 });
  await page.getByTestId('fleet-pulse').screenshot({ path: `${SHOTS}/fleet-pulse.png` });
  await page.getByRole('combobox', { name: 'Search vehicles' }).fill(items[0]!.regno.slice(0, 4));
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/top-bar-suggestions.png` });
});

test.describe('mobile 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('F08-T9: pills scroll and the filter panel is a sheet', async ({ page }) => {
    await openFitted(page);
    const pills = page.locator('[data-slot="map-status-chips"]');
    await expect(pills).toBeVisible();
    const { scroll, client } = await pills.evaluate((el) => {
      const box = el as unknown as { scrollWidth: number; clientWidth: number };
      return { scroll: box.scrollWidth, client: box.clientWidth };
    });
    expect(scroll).toBeGreaterThan(client);
    expect(await pills.getByRole('button', { name: /^Running: / }).textContent()).toMatch(
      /\d(\.\d)?K|\d/,
    );
    await page.screenshot({ path: `${SHOTS}/mobile.png` });
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.locator('[data-filter-panel="sheet"]')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Vehicle filters' })).toBeVisible();
    // Apply must be reachable without scrolling the sheet (it is pinned below the fields).
    await expect(page.getByRole('button', { name: 'Apply' })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${SHOTS}/mobile-filters.png` });
  });
});
