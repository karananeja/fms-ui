import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const SHOTS = 'docs/features/f03-access-control/screenshots';

type Fleet = { id: string; parentId: string | null; name: string; vehicleCount: number };

const tree = (page: Page) => page.getByRole('tree', { name: 'Fleet tree' });
const row = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const panel = (page: Page) => page.getByTestId('fleet-vehicles');
const dialog = (page: Page) => page.getByRole('dialog');
/** One attribute of every match (the e2e tsconfig has no DOM lib). */
const attrs = (loc: Locator, name: string) =>
  loc.evaluateAll(
    (els, n) =>
      els.map((e) => (e as unknown as { getAttribute(a: string): string }).getAttribute(n)),
    name,
  );
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function openFleets(page: Page) {
  await page.goto('/admin/fleets');
  await expect(row(page, 'Acme Mobility')).toBeVisible();
}

async function search(page: Page, q: string) {
  await page.getByRole('searchbox', { name: 'Search fleets' }).fill(q);
}

async function openMenu(page: Page, name: string) {
  await row(page, name).hover();
  await row(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  return page.getByRole('menu');
}

/** Count shown on a tree row. */
async function rowCount(page: Page, name: string): Promise<number> {
  const t = await row(page, name).getByTestId('fleet-count').textContent();
  return Number((t ?? '').replace(/,/g, ''));
}

async function fleetsByName(api: APIRequestContext): Promise<Map<string, Fleet>> {
  const list = (await (await api.get('/api/fleets')).json()) as Fleet[];
  return new Map(list.map((f) => [f.name, f]));
}

async function pickInDialog(page: Page, pickerLabel: string, name: string) {
  await dialog(page)
    .getByRole('searchbox', { name: `Search ${pickerLabel}` })
    .fill(name);
  await dialog(page)
    .getByRole('tree', { name: pickerLabel })
    .getByRole('treeitem', { name, exact: true })
    .click();
}

test.describe('F03-T3: fleets', () => {
  test('create child → rename → move under another parent → delete leaf', async ({ page }) => {
    const id = unique();
    const name = `Pune E2E ${id}`;
    const renamed = `Pune E2E ${id} renamed`;
    await openFleets(page);
    await search(page, 'Pune');

    // Create
    await (await openMenu(page, 'Pune')).getByRole('menuitem', { name: /Add child fleet/ }).click();
    await dialog(page).getByRole('textbox', { name: 'Name' }).fill(name);
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/fleets') && r.request().method() === 'POST',
    );
    await dialog(page).getByRole('button', { name: 'Add fleet' }).click();
    expect((await created).status()).toBe(201);
    await expect(row(page, name)).toBeVisible();

    // Rename inline (Esc cancels, Enter saves)
    await (await openMenu(page, name)).getByRole('menuitem', { name: 'Rename' }).click();
    const box = tree(page).getByRole('textbox', { name: 'Fleet name' });
    await box.fill('discarded');
    await box.press('Escape');
    await expect(row(page, name)).toBeVisible();
    await (await openMenu(page, name)).getByRole('menuitem', { name: 'Rename' }).click();
    await box.fill(renamed);
    const patched = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await box.press('Enter');
    expect((await patched).ok()).toBe(true);
    await expect(row(page, renamed)).toBeVisible();

    // Move under Mumbai: the picker hides the fleet's own subtree.
    await (await openMenu(page, renamed)).getByRole('menuitem', { name: /Move/ }).click();
    const picker = dialog(page).getByRole('tree', { name: 'New parent' });
    await dialog(page).getByRole('searchbox', { name: 'Search New parent' }).fill('Pune E2E');
    await expect(picker.getByRole('treeitem', { name: renamed, exact: true })).toHaveCount(0);
    await pickInDialog(page, 'New parent', 'Mumbai');
    const moved = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await dialog(page).getByRole('button', { name: 'Move', exact: true }).click();
    expect((await moved).ok()).toBe(true);
    await search(page, renamed);
    await expect(row(page, 'Mumbai')).toBeVisible();
    await expect(row(page, 'Pune')).toHaveCount(0);
    const names = await attrs(tree(page).getByRole('treeitem'), 'aria-label');
    expect(names).toEqual(['Acme Mobility', 'West', 'Mumbai', renamed]);

    // Delete the (empty) leaf
    await (await openMenu(page, renamed)).getByRole('menuitem', { name: /Delete/ }).click();
    const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE');
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).status()).toBe(204);
    await expect(row(page, renamed)).toHaveCount(0);
  });

  test('depth-5 add is disabled; delete of a non-empty fleet says why', async ({ page }) => {
    // An empty parent with one child (depth 4 → 5), so "child fleets" is the only blocker.
    const id = unique();
    const parentName = `Pune E2E parent ${id}`;
    const childName = `Pune E2E child ${id}`;
    const pune = (await fleetsByName(page.request)).get('Pune')!;
    const parent = (await (
      await page.request.post('/api/fleets', { data: { parentId: pune.id, name: parentName } })
    ).json()) as Fleet;
    await page.request.post('/api/fleets', { data: { parentId: parent.id, name: childName } });

    await openFleets(page);
    await search(page, `Pune E2E`);
    let menu = await openMenu(page, childName);
    const add = menu.getByRole('menuitem', { name: /Add child fleet/ });
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await expect(add).toContainText('at most 5 levels');
    await page.keyboard.press('Escape');

    menu = await openMenu(page, parentName);
    const del = menu.getByRole('menuitem', { name: /Delete/ });
    await expect(del).toHaveAttribute('aria-disabled', 'true');
    await expect(del).toContainText('Still has child fleets');
    await expect(menu.getByRole('menuitem', { name: /Add child fleet/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');

    menu = await openMenu(page, 'Pune');
    await expect(menu.getByRole('menuitem', { name: /Delete/ })).toContainText(
      'Still has vehicles',
    );
    await page.keyboard.press('Escape');

    menu = await openMenu(page, 'Acme Mobility');
    await expect(menu.getByRole('menuitem', { name: /Move/ })).toContainText("can't be moved");
    await expect(menu.getByRole('menuitem', { name: /Delete/ })).toContainText("can't be deleted");
  });

  test('move 3 vehicles → counts update and the table shows the new fleet', async ({ page }) => {
    test.setTimeout(60_000);
    const source = 'Pune Hub 2 · Team A';
    const target = `Pune Hub 2 E2E ${unique()}`;
    // An empty target in the same city keeps region totals (used by other specs) unchanged.
    const before = await fleetsByName(page.request);
    const res = await page.request.post('/api/fleets', {
      data: { parentId: before.get('Pune Hub 2')!.id, name: target },
    });
    expect(res.status()).toBe(201);

    await openFleets(page);
    await search(page, 'Pune Hub 2');
    const sourceBefore = await rowCount(page, source);
    expect(await rowCount(page, target)).toBe(0);
    await row(page, source).click();
    const rows = panel(page).locator('[role=row][data-vehicle-id]');
    await expect(rows.first()).toBeVisible();

    await rows.nth(0).getByRole('checkbox').click();
    await rows
      .nth(2)
      .getByRole('checkbox')
      .click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('fleet-selection-count')).toHaveText('3 selected');
    const ids = await attrs(
      panel(page).locator('[role=row][aria-selected=true]'),
      'data-vehicle-id',
    );
    expect(ids).toHaveLength(3);

    await panel(page).getByRole('button', { name: 'Move to fleet…' }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Move 3 vehicles' })).toBeVisible();
    await pickInDialog(page, 'Target fleet', target);
    await dialog(page).getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByText('Moved 3 vehicles')).toBeVisible();

    await expect.poll(() => rowCount(page, target)).toBe(3);
    expect(await rowCount(page, source)).toBe(sourceBefore - 3);
    for (const v of ids)
      await expect(panel(page).locator(`[data-vehicle-id="${v}"]`)).toHaveCount(0);

    // F09 table: filter the map to the new fleet; exactly the moved vehicles, showing its name.
    await page.goto('/live-tracking');
    await page.getByRole('button', { name: 'Filters' }).click();
    const filters = page.getByRole('dialog', { name: 'Filters' });
    await filters.getByRole('textbox', { name: 'Search fleets' }).fill(target);
    await filters.getByRole('treeitem').filter({ hasText: target }).locator('label').click();
    await filters.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: 'Table view' }).click();
    const table = page.getByTestId('table-view');
    await expect(page.getByTestId('table-count')).toContainText('· 3 vehicles', {
      ignoreCase: true,
    });
    const tableRows = table.locator('[role=row][data-vehicle-id]');
    await expect(tableRows).toHaveCount(3);
    expect((await attrs(tableRows, 'data-vehicle-id')).sort()).toEqual([...ids].sort());
    for (const r of await tableRows.all()) await expect(r).toContainText(target);
  });
});

test.describe('F03-T9: fleets UAT screenshots', () => {
  test('tree + vehicles, move dialog, mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFleets(page);
    await search(page, 'Pune Hub');
    await row(page, 'Pune Hub 1 · Team B').click();
    const rows = panel(page).locator('[role=row][data-vehicle-id]');
    await expect(rows.first()).toBeVisible();
    await rows.nth(1).getByRole('checkbox').click();
    await rows
      .nth(3)
      .getByRole('checkbox')
      .click({ modifiers: ['Shift'] });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/fleets-tree-vehicles.png` });

    await panel(page).getByRole('button', { name: 'Move to fleet…' }).click();
    await pickInDialog(page, 'Target fleet', 'Pune Hub 1 · Team A');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/fleets-move-dialog.png` });
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await openFleets(page);
    await expect(row(page, 'North')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/fleets-mobile.png` });
    await row(page, 'Delhi').click();
    await expect(panel(page).locator('[role=row][data-vehicle-id]').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/fleets-mobile-sheet.png` });
  });
});
