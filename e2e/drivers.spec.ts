import {
  driverSchema,
  vehicleListSchema,
  type Driver,
  type VehicleMeta,
} from '@shared/contract/index.ts';
import type { APIRequestContext, Page } from '@playwright/test';
import { adminApi } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';

const SHOTS = 'docs/features/f12-drivers-assignment/screenshots';
const VIEWER = { email: 'viewer@fms.local', password: 'View@1234' };

const tag = () => Math.random().toString(36).slice(2, 7);
/** A unique, searchable driver name (letters only, so it is a clean name prefix). */
const uniqueName = (first: string) =>
  `${first} ${tag().replace(/\d/g, 'q').toUpperCase()}${'abcdefghij'[Date.now() % 10]}`;
const phone = () =>
  `+91 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')} ${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;

const panel = (page: Page) => page.getByRole('region', { name: 'Vehicle details' });

async function rootFleetId(api: APIRequestContext): Promise<string> {
  const fleets = (await (await api.get('/api/fleets')).json()) as {
    id: string;
    parentId: string | null;
  }[];
  return (fleets.find((f) => f.parentId === null) ?? fleets[0]!).id;
}

/** `n` vehicles with no driver, from a random spot of the list (parallel tests don't collide). */
async function freeVehicles(
  api: APIRequestContext,
  n: number,
  fleetId?: string,
): Promise<VehicleMeta[]> {
  const cursor = fleetId ? 0 : Math.floor(Math.random() * 90_000);
  const qs = `limit=60&cursor=${cursor}${fleetId ? `&fleetId=${fleetId}` : ''}`;
  const { items } = vehicleListSchema.parse(await (await api.get(`/api/vehicles?${qs}`)).json());
  const out: VehicleMeta[] = [];
  for (const v of items.slice().reverse()) {
    const d = await (await api.get(`/api/vehicles/${v.vehicleId}/driver`)).json();
    if (d === null) out.push(v);
    if (out.length === n) return out;
  }
  throw new Error(`only ${out.length} free vehicles found`);
}

async function createDriver(api: APIRequestContext, name: string): Promise<Driver> {
  const res = await api.post('/api/drivers', {
    data: { name, phone: phone(), fleetId: await rootFleetId(api) },
  });
  expect(res.status()).toBe(201);
  return driverSchema.parse(await res.json());
}

const assign = async (api: APIRequestContext, driverId: string, vehicleId: string) =>
  expect((await api.put(`/api/drivers/${driverId}/assignment`, { data: { vehicleId } })).ok()).toBe(
    true,
  );

/** Opens the vehicle card through the URL (waits for the worker's snapshot, D-033). */
async function openVehicle(page: Page, v: VehicleMeta) {
  await page.goto(`/live-tracking?vehicle=${v.vehicleId}`);
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno, { timeout: 20_000 });
}

async function openDriverRow(page: Page, name: string) {
  await page.goto('/admin/drivers');
  await page.getByLabel('Search drivers').fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  await row.click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
}

async function assignInDrawer(page: Page, v: VehicleMeta, button: 'Assign' | 'Reassign') {
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Assign a vehicle to/ });
  await dialog.getByLabel('Search vehicles by reg no').fill(v.regno);
  await dialog.getByRole('button', { name: new RegExp(v.regno) }).click();
  await dialog.getByRole('button', { name: /^(Assign|Reassign)$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('panel-vehicle')).toContainText(v.regno, { timeout: 10_000 });
}

test('F12-T3: create → assign → card shows driver → reassign → history → unassign', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const api = await adminApi(baseURL!);
  const [v1, v2] = await freeVehicles(api, 2);
  const name = uniqueName('Ravi');

  await page.goto('/admin/drivers');
  await page.getByRole('button', { name: 'Add driver' }).click();
  const form = page.getByTestId('driver-form');
  await form.getByRole('button', { name: 'Add driver' }).click();
  await expect(form.getByText('Enter the driver’s name.')).toBeVisible();
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Phone').fill(phone().replace(/\D/g, '').slice(2));
  await form.getByRole('tree', { name: 'Fleet' }).getByRole('treeitem').first().click();
  await form.getByRole('button', { name: 'Add driver' }).click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await expect(page.getByTestId('panel-vehicle')).toHaveText('No vehicle assigned');

  await assignInDrawer(page, v1!, 'Assign');

  await openVehicle(page, v1!);
  await expect(panel(page).getByTestId('driver-name')).toHaveText(name, { timeout: 10_000 });
  await expect(panel(page).getByTestId('driver-since')).toHaveText('since < 1 min');

  await openDriverRow(page, name);
  await assignInDrawer(page, v2!, 'Reassign');
  const history = page.getByTestId('history-row');
  await expect(history).toHaveCount(2, { timeout: 10_000 });
  await expect(history.nth(0)).toContainText(v2!.regno);
  await expect(history.nth(0)).toContainText('Current');
  await expect(history.nth(1)).toContainText(v1!.regno);

  await page.getByRole('button', { name: 'Unassign' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Unassign' }).click();
  await expect(page.getByTestId('panel-vehicle')).toHaveText('No vehicle assigned');
  await expect(page.getByText('Current')).toHaveCount(0);

  await openVehicle(page, v1!);
  await expect(panel(page).getByTestId('driver-none')).toBeVisible({ timeout: 10_000 });
  await api.dispose();
});

test('F12-T4: an assignment made elsewhere shows live on an open vehicle card', async ({
  page,
  baseURL,
}) => {
  const api = await adminApi(baseURL!);
  const [v] = await freeVehicles(api, 1);
  const driver = await createDriver(api, uniqueName('Anita'));
  await openVehicle(page, v!);
  await expect(panel(page).getByTestId('driver-none')).toBeVisible({ timeout: 10_000 });

  await assign(api, driver.id, v!.vehicleId);
  await expect(panel(page).getByTestId('driver-name')).toHaveText(driver.name, { timeout: 5_000 });

  expect((await api.delete(`/api/drivers/${driver.id}/assignment`)).status()).toBe(204);
  await expect(panel(page).getByTestId('driver-none')).toBeVisible({ timeout: 5_000 });
  await api.dispose();
});

test('F12-T5: Driver search opens the vehicle card', async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const [v] = await freeVehicles(api, 1);
  const driver = await createDriver(api, uniqueName('Zubin'));
  await assign(api, driver.id, v!.vehicleId);

  await page.goto('/live-tracking');
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 15_000 });
  await page.getByRole('button', { name: /^Search field:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Driver' }).click();
  const box = page.getByRole('combobox', { name: 'Search vehicles' });
  await box.fill(driver.name.split(' ')[1]!);
  const option = page
    .getByRole('listbox', { name: 'Vehicle suggestions' })
    .getByRole('option')
    .filter({ hasText: driver.name });
  await expect(option).toContainText(`${driver.name} · ${v!.regno}`, { timeout: 10_000 });
  await option.click();
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v!.regno, { timeout: 10_000 });
  await expect(panel(page).getByTestId('driver-name')).toHaveText(driver.name);
  await api.dispose();
});

test.describe('F12-T5: Viewer', () => {
  test.use({ storageState: SIGNED_OUT });

  test('sees the driver read-only and no Drivers nav', async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    expect((await page.request.post('/api/auth/login', { data: VIEWER })).ok()).toBe(true);
    const me = (await (await page.request.get('/api/auth/me')).json()) as { fleetIds: string[] };
    const [v] = await freeVehicles(api, 1, me.fleetIds[0]);
    const driver = await createDriver(api, uniqueName('Meera'));
    await assign(api, driver.id, v!.vehicleId);

    await openVehicle(page, v!);
    await expect(panel(page).getByTestId('driver-name')).toHaveText(driver.name, {
      timeout: 10_000,
    });
    await expect(panel(page).getByTestId('driver-section').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Drivers' })).toHaveCount(
      0,
    );
    await page.goto('/admin/drivers');
    await expect(page.getByRole('heading', { name: 'Drivers' })).toHaveCount(0);
    await api.dispose();
  });
});

test('F12-T6: UAT screenshots', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const api = await adminApi(baseURL!);
  const [v] = await freeVehicles(api, 1);
  const first = await createDriver(api, uniqueName('Ravi'));
  const second = await createDriver(api, uniqueName('Kavya'));
  await assign(api, first.id, v!.vehicleId);

  await page.goto('/admin/drivers');
  await expect(page.getByRole('row').nth(3)).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/drivers-page.png` });

  await page.getByRole('button', { name: 'Add driver' }).click();
  await page.getByTestId('driver-form').getByRole('button', { name: 'Add driver' }).click();
  await page.screenshot({ path: `${SHOTS}/driver-form.png` });
  await page.keyboard.press('Escape');

  await openVehicle(page, v!);
  const section = panel(page).getByTestId('driver-section');
  await expect(section.getByTestId('driver-name')).toHaveText(first.name, { timeout: 10_000 });
  await section.screenshot({ path: `${SHOTS}/card-driver-section.png` });
  await page.screenshot({ path: `${SHOTS}/card-desktop.png` });

  await section.getByRole('button', { name: 'Change' }).click();
  const dialog = page.getByRole('dialog', { name: /Assign a driver to/ });
  await dialog.getByLabel('Search drivers by name').fill(second.name);
  await dialog.getByRole('button', { name: new RegExp(second.name) }).click();
  await expect(dialog.getByTestId('assign-conflict')).toContainText('is driven by');
  await page.screenshot({ path: `${SHOTS}/assign-conflict.png` });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/live-tracking?vehicle=${v!.vehicleId}`);
  await expect(page.getByTestId('driver-name')).toHaveText(first.name, { timeout: 20_000 });
  await page.getByTestId('driver-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/card-mobile.png` });
  await api.dispose();
});
