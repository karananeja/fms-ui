import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, mapState, metres, settled, test } from './fixtures.ts';
import { scrollTable, tableTotal, type Scroller } from './table-helpers.ts';

const SHOTS = 'docs/features/f09-table-view-csv/screenshots';

const table = (page: Page) => page.getByTestId('table-view');
const tray = (page: Page) => page.getByTestId('vehicle-tray');
const panel = (page: Page) => page.getByRole('region', { name: 'Vehicle details' });
const count = (page: Page) => page.getByTestId('table-count');

/** Opens the map and waits (bounded) for the one auto-fit after the snapshot. */
async function openFitted(page: Page, path = '/live-tracking') {
  await page.goto(path);
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  return settled(page);
}

async function jumpToPune(page: Page, fromZoom: number) {
  await page.getByRole('button', { name: 'Jump to city…' }).click();
  await page.getByRole('textbox', { name: 'Search city' }).fill('pun');
  await page.getByRole('option', { name: /Pune/ }).getByRole('button').click();
  await expect
    .poll(async () => (await mapState(page))?.zoom ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(fromZoom + 3);
  return settled(page);
}

async function drag(page: Page, dx: number, dy: number) {
  const box = (await page.getByTestId('live-map').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Splits RFC 4180 text into records (quoted fields may hold commas, quotes and newlines). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  if (field || row.length) out.push([...row, field]);
  return out;
}

const headerLabels = (page: Page) =>
  table(page)
    .getByRole('columnheader')
    .allTextContents()
    // The Actions header has no text.
    .then((all) => all.map((t) => t.trim()).filter(Boolean));

const cardIds = async (page: Page) =>
  Promise.all(
    (await tray(page).locator('button[data-vehicle-id]').all()).map((c) =>
      c.getAttribute('data-vehicle-id'),
    ),
  );

test('F09-T6: camera kept across views; ?view=table deep-links; scopes; row → card; Locate → zoom 16', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fitted = await openFitted(page);
  const pune = await jumpToPune(page, fitted.zoom);

  // Map → table → map keeps the camera (the map stays mounted underneath).
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(table(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=table/);
  await expect(tray(page)).toHaveCount(0);

  // Viewport (Pune, captured on open) ≤ All.
  await expect.poll(() => tableTotal(page), { timeout: 10_000 }).toBeGreaterThan(0);
  const all = (await tableTotal(page))!;
  await page.getByRole('button', { name: 'Viewport' }).click();
  await expect(count(page)).toContainText(/viewport/i);
  await expect.poll(() => tableTotal(page)).toBeLessThan(all);
  const viewport = (await tableTotal(page))!;
  expect(viewport).toBeGreaterThan(0);
  expect(viewport).toBeLessThanOrEqual(all);

  await page.getByRole('button', { name: 'Back to map' }).click();
  await expect(table(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/view=table/);
  const back = (await mapState(page))!;
  expect(back.zoom).toBeCloseTo(pune.zoom, 5);
  expect(metres(back.center, pune.center)).toBeLessThan(1);

  // Deep link straight into the table.
  await page.goto('/live-tracking?view=table');
  await expect(table(page)).toBeVisible();
  await expect.poll(() => tableTotal(page), { timeout: 15_000 }).toBeGreaterThan(0);

  // Clicking a row selects it: the details card floats over the table.
  const row = table(page).locator('[role=row][data-vehicle-id]').first();
  const id = (await row.getAttribute('data-vehicle-id'))!;
  const regno = (await row.getByRole('cell').first().textContent())!.trim();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`[?&]vehicle=${id}(&|$)`));
  await expect(panel(page).getByTestId('details-regno')).toHaveText(regno, { timeout: 15_000 });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(table(page)).toBeVisible();

  // Locate returns to the map and flies to the vehicle at zoom 16.
  await table(page)
    .getByRole('button', { name: `Locate ${regno}` })
    .click();
  await expect(table(page)).toHaveCount(0);
  await expect
    .poll(async () => Math.abs(((await mapState(page))?.zoom ?? 0) - 16), { timeout: 10_000 })
    .toBeLessThan(0.05);
  expect((await mapState(page))!.selectedVehicleId).toBe(id);
});

test('F09-T7: 1 lakh rows scroll virtualised; export matches the table (budgets: table-view.perf)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/live-tracking?view=table');
  await expect.poll(() => tableTotal(page), { timeout: 20_000 }).toBe(100_000);
  const scroller = page.getByTestId('table-scroller');
  await expect(scroller.locator('[role=row][data-vehicle-id]').first()).toBeVisible();

  await scrollTable(page);
  // Jump to the very end: the last row (aria-rowindex = total + 1, header is 1) is loaded.
  await scroller.evaluate((el) => {
    const e = el as unknown as Scroller;
    e.scrollTop = e.scrollHeight;
  });
  await expect(
    scroller.locator('[role=row][aria-rowindex="100001"][data-vehicle-id]'),
  ).toBeVisible();
  expect(await scroller.locator('[role=row]').count()).toBeLessThan(80);

  // Hide a column so "header = visible columns" is meaningful, then export.
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'VIN' }).click();
  await page.keyboard.press('Escape');
  const visible = await headerLabels(page);
  expect(visible).not.toContain('VIN');
  const total = (await tableTotal(page))!;

  const downloading = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^fleet-vehicles-\d{8}-\d{4}\.csv$/);
  const records = parseCsv(readFileSync((await download.path())!, 'utf8'));
  expect(records[0]).toEqual(visible);
  expect(records.length - 1).toBe(total);
  await expect(page.getByText(`Exported ${total.toLocaleString('en-IN')} rows`)).toBeVisible();
});

test('F09-T8: the tray shows viewport cards, selects on click, and updates after panning', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fitted = await openFitted(page);
  await jumpToPune(page, fitted.zoom);
  const cards = tray(page).locator('button[data-vehicle-id]');
  await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await cards.count()).toBeLessThanOrEqual(24);
  const before = await cardIds(page);

  const card = cards.first();
  const id = (await card.getAttribute('data-vehicle-id'))!;
  const { bounds } = (await mapState(page))!;
  await card.click();
  await expect.poll(async () => (await mapState(page))?.selectedVehicleId).toBe(id);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page)).toBeVisible();
  // The selected vehicle is inside the view the tray was built from.
  await expect
    .poll(async () => (await mapState(page))?.highlight, { timeout: 10_000 })
    .not.toBeNull();
  const [lng, lat] = (await mapState(page))!.highlight!;
  const [w, s, e, n] = bounds as [number, number, number, number];
  expect(lng).toBeGreaterThan(w - 0.01);
  expect(lng).toBeLessThan(e + 0.01);
  expect(lat).toBeGreaterThan(s - 0.01);
  expect(lat).toBeLessThan(n + 0.01);

  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(panel(page)).toBeHidden();
  const v = (await mapState(page))!.frameVersion;
  await drag(page, -500, 0);
  await settled(page, v);
  await expect
    .poll(async () => JSON.stringify(await cardIds(page)), { timeout: 10_000 })
    .not.toBe(JSON.stringify(before));
});

test.describe('F09-T9: UAT screenshots', () => {
  test('desktop: table, column menu, export in progress, map with tray', async ({ page }) => {
    test.setTimeout(90_000);
    const fitted = await openFitted(page);
    await jumpToPune(page, fitted.zoom);
    const cards = tray(page).locator('button[data-vehicle-id]');
    await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThan(3);
    await cards.nth(1).click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/map-with-tray.png` });
    await page.getByRole('button', { name: 'Close details' }).click();

    await page.getByRole('button', { name: 'Table view' }).click();
    await expect.poll(() => tableTotal(page), { timeout: 10_000 }).toBe(100_000);
    const row = table(page).locator('[role=row][data-vehicle-id]').nth(2);
    await row.click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/table-desktop.png` });
    await page.getByRole('button', { name: 'Close details' }).click();

    await page.getByRole('button', { name: 'Columns' }).click();
    await expect(page.getByRole('menu', { name: 'Columns' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/column-menu.png` });
    await page.keyboard.press('Escape');

    // Slow the CPU so the progress toast is on screen long enough to capture.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await expect(page.getByText(/Exporting CSV… \d+%/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/export-in-progress.png` });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await expect(page.getByText(/Exported [\d,]+ rows/)).toBeVisible({ timeout: 30_000 });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('mobile table: Regno, Status, SOC; no tray', async ({ page }) => {
      await openFitted(page);
      await expect(tray(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Table view' }).click();
      await expect.poll(() => tableTotal(page), { timeout: 10_000 }).toBe(100_000);
      expect(await headerLabels(page)).toEqual(['Regno', 'Status', 'SOC (%)']);
      await expect(page.getByRole('button', { name: 'Back to map' })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Columns' })).toBeInViewport({ ratio: 1 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/mobile-table.png` });
    });
  });
});
