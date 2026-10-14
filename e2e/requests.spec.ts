import {
  driverRequestSchema,
  driverSchema,
  vehicleListSchema,
  type Driver,
  type DriverRequest,
  type Fleet,
  type VehicleMeta,
} from '@shared/contract/index.ts';
import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, mailLink } from './auth-helpers.ts';
import { expect, test } from './fixtures.ts';

const SHOTS = 'docs/features/f14-operator-request-desk/screenshots';
const PASSWORD = 'Drive@1234';

const tag = () => Math.random().toString(36).slice(2, 8);
const phone = () =>
  `+91 9${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')} ${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;

/** Leaf fleets with vehicles, shuffled (parallel tests pick different ones). */
async function leafFleets(api: APIRequestContext): Promise<Fleet[]> {
  const fleets = (await (await api.get('/api/fleets')).json()) as Fleet[];
  const parents = new Set(fleets.map((f) => f.parentId));
  return fleets
    .filter((f) => !parents.has(f.id) && f.vehicleCount >= 100)
    .sort(() => Math.random() - 0.5);
}

/** A vehicle of `fleetId` (direct) with no driver. */
async function freeVehicle(api: APIRequestContext, fleetId: string): Promise<VehicleMeta> {
  const { items } = vehicleListSchema.parse(
    await (await api.get(`/api/vehicles?fleetId=${fleetId}&limit=80`)).json(),
  );
  for (const v of items.sort(() => Math.random() - 0.5)) {
    const d = await (await api.get(`/api/vehicles/${v.vehicleId}/driver`)).json();
    if (d === null) return v;
  }
  throw new Error(`no free vehicle in ${fleetId}`);
}

interface DriverUser {
  driver: Driver;
  /** Signed in as the driver (F11 `driver.self`). */
  ctx: APIRequestContext;
  vehicle: VehicleMeta;
}

/** A brand-new Driver-role user (invite → accept) on `vehicle`: the test's own requester. */
async function newDriver(
  api: APIRequestContext,
  baseURL: string,
  fleetId: string,
  vehicle: VehicleMeta,
): Promise<DriverUser> {
  const email = `f14-${tag()}-${Date.now()}@fms.local`;
  const res = await api.post('/api/drivers', {
    data: { name: `Driver ${tag().toUpperCase()}`, phone: phone(), fleetId, invite: true, email },
  });
  expect(res.status()).toBe(201);
  const driver = driverSchema.parse(await res.json());
  const token = new URL(await mailLink(api, email, 'invite'), baseURL).searchParams.get('token')!;
  const ctx = await apiRequest.newContext({ baseURL });
  expect(
    (
      await ctx.post('/api/auth/accept-invite', {
        data: { token, name: driver.name, password: PASSWORD },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await api.put(`/api/drivers/${driver.id}/assignment`, {
        data: { vehicleId: vehicle.vehicleId },
      })
    ).ok(),
  ).toBe(true);
  return { driver, ctx, vehicle };
}

async function report(d: DriverUser, data: Record<string, unknown>): Promise<DriverRequest> {
  const res = await d.ctx.post('/api/requests', { data });
  expect(res.status(), await res.text()).toBe(201);
  return driverRequestSchema.parse(await res.json());
}

const row = (page: Page, id: string) => page.locator(`[role="row"][data-row-key="${id}"]`);
const drawer = (page: Page) => page.getByRole('dialog');

async function act(page: Page, button: string, note?: string) {
  await drawer(page).getByTestId(`action-${button.toLowerCase()}`).click();
  if (note) await drawer(page).getByLabel('Note (optional)').fill(note);
  await drawer(page)
    .getByRole('button', { name: `Confirm ${button.toLowerCase()}` })
    .click();
}

const status = (page: Page) => drawer(page).locator('[data-status]').first();

test('F14-T3: breakdown → desk within 5 s → acknowledge → suggest → approve → driver reassigned', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);
  const [fleet] = await leafFleets(api);
  const d = await newDriver(api, baseURL!, fleet!.id, await freeVehicle(api, fleet!.id));

  await page.goto('/requests');
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
  const before = Number(await page.getByTestId('desk-open-count').textContent());

  const breakdown = await report(d, { type: 'breakdown', reason: 'tyre', note: 'Flat tyre' });
  const r = row(page, breakdown.id);
  await expect(r).toBeVisible({ timeout: 5_000 });
  await expect(r).toHaveAttribute('data-highlighted', 'true');
  await expect(r).toContainText(d.vehicle.regno, { timeout: 10_000 });
  await expect(r).toContainText('Tyre problem');
  await expect(page.getByTestId('desk-open-count')).toHaveText(String(before + 1));
  await expect(page.getByTestId('requests-badge-rail')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desk.png` });

  await r.click();
  await expect(page).toHaveURL(new RegExp(`/requests/${breakdown.id}$`));
  await expect(drawer(page).getByTestId('request-driver')).toHaveText(d.driver.name, {
    timeout: 10_000,
  });
  await expect(drawer(page).getByTestId('request-map')).toBeVisible();
  await act(page, 'Acknowledge', 'Calling the driver');
  await expect(status(page)).toHaveText('Acknowledged');
  await expect(drawer(page).getByTestId('timeline')).toContainText('Calling the driver');
  await drawer(page).getByRole('button', { name: 'Suggest replacement' }).click();
  await expect(drawer(page).getByTestId('candidate').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/drawer-breakdown.png` });

  // The driver asks for the replacement; the breakdown drawer links to it once it arrives.
  const replacement = await report(d, { type: 'replacement', note: 'Need another vehicle' });
  await drawer(page).getByRole('link', { name: 'Open it to approve' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${replacement.id}$`));
  await expect(status(page)).toHaveText('Suggested', { timeout: 5_000 });
  const suggested = drawer(page).getByTestId('candidate').filter({ hasText: 'Suggested' });
  await expect(suggested).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/drawer-replacement.png` });
  await drawer(page).getByRole('button', { name: 'Approve' }).click();
  await expect(status(page)).toHaveText('Assigned');
  await expect(drawer(page).getByTestId('replacement-assigned')).toBeVisible();

  // API check: the driver is now on the replacement vehicle.
  const done = driverRequestSchema.parse(
    await (await api.get(`/api/requests/${replacement.id}`)).json(),
  );
  const newVehicle = done.replacement?.assignedVehicleId;
  expect(newVehicle).toBeTruthy();
  expect(newVehicle).not.toBe(d.vehicle.vehicleId);
  const me = (await (await d.ctx.get('/api/driver/me')).json()) as {
    vehicle: { meta: { vehicleId: string } } | null;
  };
  expect(me.vehicle?.meta.vehicleId).toBe(newVehicle);

  await expect(drawer(page).getByTestId('action-close')).toHaveCount(0);
  await page.goto(`/requests/${breakdown.id}`);
  await act(page, 'Resolve');
  await expect(status(page)).toHaveText('Resolved');
  await d.ctx.dispose();
  await api.dispose();
});

test('F14-T4: RSA dispatch → resolve with a full timeline; override with an unavailable vehicle shows the reason', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);
  const [, fleet] = await leafFleets(api);
  const d = await newDriver(api, baseURL!, fleet!.id, await freeVehicle(api, fleet!.id));

  const rsa = await report(d, { type: 'rsa', note: 'Battery flat on the highway' });
  await page.goto(`/requests/${rsa.id}`);
  await expect(status(page)).toHaveText('Open', { timeout: 10_000 });
  await expect(drawer(page).getByRole('button', { name: 'Dispatch RSA' })).toHaveCount(0);
  await act(page, 'Acknowledge');
  await expect(status(page)).toHaveText('Acknowledged');
  await drawer(page).getByRole('button', { name: 'Dispatch RSA' }).click();
  await drawer(page).getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(drawer(page).getByText('Enter who is going.')).toBeVisible();
  await drawer(page).getByLabel('Assignee').fill('Tow team 7');
  await drawer(page).getByLabel('ETA (minutes)').fill('40');
  await page.screenshot({ path: `${SHOTS}/drawer-rsa-dispatch.png` });
  await drawer(page).getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(status(page)).toHaveText('Dispatched');
  await expect(drawer(page).getByTestId('rsa-details')).toHaveText('Tow team 7 · ETA 40 min');
  await act(page, 'Resolve', 'Battery jump-started');
  await expect(status(page)).toHaveText('Resolved');
  const timeline = drawer(page).getByTestId('timeline').getByRole('listitem');
  await expect(timeline).toHaveCount(4);
  await expect(timeline.nth(0)).toContainText('Roadside assistance reported');
  await expect(timeline.nth(1)).toContainText('Acknowledged · You');
  await expect(timeline.nth(2)).toContainText('Dispatched');
  await expect(timeline.nth(3)).toContainText('Resolved');
  await expect(timeline.nth(3)).toContainText('Battery jump-started');
  await page.screenshot({ path: `${SHOTS}/drawer-rsa.png` });

  // Override with the request's own vehicle (it has a driver): the server's reason shows.
  const repl = await report(d, { type: 'replacement' });
  await page.goto(`/requests/${repl.id}`);
  await expect(drawer(page).getByTestId('replacement-panel')).toBeVisible({ timeout: 10_000 });
  await drawer(page).getByRole('button', { name: 'Override' }).click();
  await drawer(page).getByLabel('Search a replacement vehicle').fill(d.vehicle.regno);
  await drawer(page).getByRole('button', { name: d.vehicle.regno, exact: true }).click();
  await drawer(page)
    .getByRole('button', { name: `Assign ${d.vehicle.regno}` })
    .click();
  await expect(drawer(page).getByTestId('replacement-error')).toHaveText(
    'Vehicle is not available',
  );
  await page.screenshot({ path: `${SHOTS}/drawer-override-error.png` });
  await drawer(page).getByRole('button', { name: 'Cancel' }).click();
  await act(page, 'Reject', 'Test cleanup');
  await expect(status(page)).toHaveText('Rejected');
  await d.ctx.dispose();
  await api.dispose();
});

test('F14-T5: auto-assign on → a new replacement is assigned without the operator', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);
  const fleets = await leafFleets(api);
  const fleet = fleets[2]!;
  const d = await newDriver(api, baseURL!, fleet.id, await freeVehicle(api, fleet.id));
  try {
    await page.goto('/requests');
    await page.getByRole('button', { name: 'Filter by fleet' }).click();
    await page.getByLabel('Search Fleet filter').fill(fleet.name);
    await page.getByRole('treeitem', { name: fleet.name, exact: true }).first().click();
    const toggle = page.getByRole('switch', { name: 'Assign replacements automatically' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
    await expect(page.getByTestId('auto-assign-source')).toHaveText(
      'Inherited from a parent fleet',
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('auto-assign-source')).toHaveText('Set on this fleet');
    await page.screenshot({ path: `${SHOTS}/auto-assign-toggle.png` });

    await page.getByLabel('Filter by status').selectOption('all');
    const repl = await report(d, { type: 'replacement' });
    // The engine assigns at once; the row arrives already assigned.
    await expect(row(page, repl.id)).toContainText('Assigned', { timeout: 5_000 });
    await row(page, repl.id).click();
    await expect(drawer(page).getByTestId('timeline')).toContainText('Assigned automatically');
    await expect(drawer(page).getByTestId('replacement-assigned')).toContainText(
      'Assigned automatically',
    );
    await page.screenshot({ path: `${SHOTS}/drawer-auto-assigned.png` });

    // The same toggle sits in the F03 fleet detail.
    await page.goto('/admin/fleets');
    await page.getByLabel('Search fleets').fill(fleet.name);
    await page
      .getByRole('treeitem', { name: new RegExp(fleet.name) })
      .first()
      .click();
    await expect(
      page.getByTestId('fleet-vehicles').getByRole('switch', {
        name: 'Assign replacements automatically',
      }),
    ).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/auto-assign-fleet-detail.png` });
  } finally {
    await api.patch(`/api/fleets/${fleet.id}/settings`, { data: { autoAssignReplacement: null } });
    await d.ctx.dispose();
    await api.dispose();
  }
});

/** A vehicle in no-GPS (signal-derived, device still online) with no driver. */
async function noGpsVehicle(
  api: APIRequestContext,
  wantFree: boolean,
): Promise<{ v: VehicleMeta; insight: { signals: Record<string, boolean>; likelyCause: string } }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const cursor = Math.floor(Math.random() * 90_000);
    const { items } = vehicleListSchema.parse(
      await (await api.get(`/api/vehicles?cursor=${cursor}&limit=100`)).json(),
    );
    for (const v of items) {
      const res = await api.get(`/api/vehicles/${v.vehicleId}/no-gps-insight`);
      if (!res.ok()) continue;
      const insight = (await res.json()) as {
        signals: Record<string, boolean>;
        likelyCause: string;
      };
      if (insight.signals.deviceOffline) continue;
      if (
        wantFree &&
        (await (await api.get(`/api/vehicles/${v.vehicleId}/driver`)).json()) !== null
      )
        continue;
      return { v, insight };
    }
  }
  throw new Error('no no-GPS vehicle found');
}

async function openCard(page: Page, v: VehicleMeta) {
  await page.goto(`/live-tracking?vehicle=${v.vehicleId}`);
  await expect(
    page.getByRole('region', { name: 'Vehicle details' }).getByTestId('details-regno'),
  ).toHaveText(v.regno, { timeout: 20_000 });
}

test('F14-T6: no-GPS insight — signal-derived chips; driver-reported reason links to the request', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);

  const { v, insight } = await noGpsVehicle(api, false);
  await openCard(page, v);
  const section = page.getByTestId('no-gps-insight');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section.getByTestId('no-gps-cause')).toHaveAttribute(
    'data-cause',
    insight.likelyCause,
  );
  await expect(
    section.getByRole('list', { name: 'Device signals' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(section.getByText(/^Device battery \d/)).toBeVisible();
  await expect(section.getByText(/^Signal −?\d+ dBm/)).toBeVisible();
  await expect(section.getByTestId('no-gps-since')).toContainText('IST');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/no-gps-insight-signals.png` });

  // Driver-reported: a driver on a no-GPS vehicle reports a faulty GPS device.
  const found = await noGpsVehicle(api, true);
  const vehicle = found.v;
  const d = await newDriver(api, baseURL!, vehicle.fleetId, vehicle);
  const breakdown = await report(d, { type: 'breakdown', reason: 'no-gps-device' });
  await openCard(page, vehicle);
  const s2 = page.getByTestId('no-gps-insight');
  await expect(s2.getByTestId('no-gps-cause')).toHaveAttribute('data-cause', 'driver-reported', {
    timeout: 10_000,
  });
  await expect(s2.getByTestId('no-gps-reported')).toContainText('GPS device not working');
  await s2.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/no-gps-insight-reported.png` });
  // Mobile: the card re-mounts as a bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(s2.getByTestId('no-gps-reported')).toBeVisible({ timeout: 10_000 });
  await s2.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/no-gps-insight-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(s2.getByTestId('no-gps-reported')).toBeVisible({ timeout: 10_000 });
  await s2.getByRole('link', { name: 'View request' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${breakdown.id}$`));
  await expect(drawer(page).getByTestId('request-reason')).toHaveText('GPS device not working');
  await act(page, 'Acknowledge');
  await act(page, 'Close', 'Test cleanup');
  await expect(status(page)).toHaveText('Closed');
  await d.ctx.dispose();
  await api.dispose();
});

test('F14-T7: desk on mobile and a notification opens the request', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const api = await adminApi(baseURL!);
  const [, , , fleet] = await leafFleets(api);
  const d = await newDriver(api, baseURL!, fleet!.id, await freeVehicle(api, fleet!.id));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/requests');
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
  const r = await report(d, { type: 'breakdown', reason: 'accident', note: 'Minor collision' });
  await expect(row(page, r.id)).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: `${SHOTS}/desk-mobile.png` });
  await row(page, r.id).click();
  await expect(drawer(page).getByTestId('request-reason')).toHaveText('Accident');
  await page.screenshot({ path: `${SHOTS}/drawer-mobile.png` });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/admin');
  await page.getByTestId('notification-bell').click();
  await page.getByTestId('notification-item').filter({ hasText: d.driver.name }).first().click();
  await expect(page).toHaveURL(new RegExp(`/requests/${r.id}$`));
  await act(page, 'Acknowledge');
  await act(page, 'Close', 'Test cleanup');
  await d.ctx.dispose();
  await api.dispose();
});
