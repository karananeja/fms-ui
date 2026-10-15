import type { APIRequestContext, Page } from '@playwright/test';
import type { Fleet, Permission, ShareLink, VehicleMeta } from '@shared/contract/index.ts';
import { adminApi, mailLink } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

const SHOTS = 'docs/features/f10-share-live-location/screenshots';
const HOUR = 3_600_000;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const panel = (page: Page) => page.getByRole('region', { name: 'Vehicle details' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Share live location' });

async function someVehicles(api: APIRequestContext, n: number, skip = 0): Promise<VehicleMeta[]> {
  const res = await api.get(`/api/vehicles?limit=${n + skip}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { items: VehicleMeta[] }).items.slice(skip);
}

async function apiShare(
  api: APIRequestContext,
  vehicleId: string,
  over: Partial<Pick<ShareLink, 'show' | 'trail' | 'expiresAt'>> = {},
): Promise<ShareLink> {
  const res = await api.post('/api/share-links', {
    data: {
      vehicleId,
      expiresAt: Date.now() + 6 * HOUR,
      show: { drivingEnergy: false, device: false },
      trail: { enabled: false, windowMinutes: 60 },
      ...over,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as ShareLink;
}

const tokenOf = (url: string) => url.split('/share/')[1]!;

async function openDetails(page: Page, v: VehicleMeta) {
  await page.goto(`/live-tracking?vehicle=${v.vehicleId}`);
  await expect(panel(page).getByTestId('details-regno')).toHaveText(v.regno, { timeout: 20_000 });
}

test('F10-T3: super admin creates from the details card, copies, revokes from the Links tab', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! });
  const [v] = await someVehicles(page.request, 1, 3);
  await openDetails(page, v!);

  await panel(page).getByTestId('share-cta').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(v!.regno);
  await expect(dialog(page).getByTestId('share-expiry-note')).toContainText(/Expires .* IST/);
  await dialog(page)
    .getByRole('checkbox', { name: /Driving · energy/ })
    .check();
  await dialog(page)
    .getByRole('checkbox', { name: /Show trail/ })
    .check();
  await shot(page, { path: `${SHOTS}/share-dialog-create.png` });

  await dialog(page).getByRole('button', { name: 'Create link' }).click();
  const urlField = dialog(page).getByRole('textbox', { name: 'Share link URL' });
  await expect(urlField).toHaveValue(new RegExp(`^${baseURL}/share/[\\w-]+$`));
  const url = await urlField.inputValue();
  await dialog(page).getByRole('button', { name: 'Copy' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(url);
  await shot(page, { path: `${SHOTS}/share-dialog-result.png` });

  const token = tokenOf(url);
  expect((await page.request.get(`/api/public/share/${token}`)).status()).toBe(200);

  await dialog(page).getByRole('tab', { name: /Links/ }).click();
  const row = dialog(page).locator('li[data-status="active"]').first();
  await expect(row).toContainText('Trail 1 h');
  await expect(row).toContainText('by You');
  await shot(page, { path: `${SHOTS}/share-dialog-links.png` });

  await row.getByRole('button', { name: 'Revoke link' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Revoke this link?' });
  await expect(confirm).toContainText('Anyone with this link loses access now.');
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(confirm).toBeHidden();
  await expect
    .poll(async () => (await page.request.get(`/api/public/share/${token}`)).status())
    .toBe(410);
});

test('F10-T3: admin share links page lists, filters, searches and revokes', async ({ page }) => {
  test.setTimeout(60_000);
  const [a, b] = await someVehicles(page.request, 2, 10);
  const keep = await apiShare(page.request, a!.vehicleId, {
    show: { drivingEnergy: true, device: true },
    trail: { enabled: true, windowMinutes: 15 },
  });
  const gone = await apiShare(page.request, b!.vehicleId);
  expect((await page.request.delete(`/api/share-links/${gone.id}`)).status()).toBe(204);

  await page.goto('/admin');
  await expect(page.getByTestId('overview-share-links')).toContainText(/\d+ active/);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Share links' })
    .click();
  await expect(page).toHaveURL(/\/admin\/share-links$/);
  const table = page.getByRole('table', { name: 'Share links' });

  // Default filter: Active. Search by regno.
  await expect(page.getByRole('button', { name: /^Active/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('searchbox', { name: 'Search by regno' }).fill(a!.regno);
  const row = table.locator(`tr[data-row-key="${keep.id}"]`);
  await expect(row.getByTestId('share-row-regno')).toHaveText(a!.regno, { timeout: 10_000 });
  await expect(row.getByTestId('share-row-regno')).toHaveAttribute(
    'href',
    `/live-tracking?vehicle=${a!.vehicleId}`,
  );
  await expect(row).toContainText('Trail 15 min');
  await expect(row.locator('[data-status]')).toHaveAttribute('data-status', 'active');
  await page.getByRole('searchbox', { name: 'Search by regno' }).fill('');
  await shot(page, { path: `${SHOTS}/share-admin-links.png`, fullPage: true });

  // The revoked link shows under Revoked only.
  await expect(table.locator(`tr[data-row-key="${gone.id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: /^Revoked/ }).click();
  await expect(table.locator(`tr[data-row-key="${gone.id}"] [data-status]`)).toHaveAttribute(
    'data-status',
    'revoked',
  );

  // Revoke from the page.
  await page.getByRole('button', { name: /^Active/ }).click();
  await row.getByRole('button', { name: /^Revoke link for/ }).click();
  await page
    .getByRole('alertdialog', { name: 'Revoke this link?' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(row).toHaveCount(0);
  expect((await page.request.get(`/api/public/share/${keep.token}`)).status()).toBe(410);
});

test.describe('without share.revoke', () => {
  test.use({ storageState: SIGNED_OUT });

  test('F10-T3: sees only its own links and no admin page', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const admin = await adminApi(baseURL!);
    const permissions: Permission[] = ['live.view', 'vehicle.details.view', 'share.create'];
    const role = await admin.post('/api/roles', {
      data: { name: `F10 Sharer ${uid()}`, permissions },
    });
    expect(role.status()).toBe(201);
    const roleId = ((await role.json()) as { id: string }).id;
    const fleets = (await (await admin.get('/api/fleets')).json()) as Fleet[];
    const email = `f10-sharer-${uid()}@fms.local`;
    const invite = await admin.post('/api/invites', {
      data: { email, roleId, fleetIds: [fleets.find((f) => f.parentId === null)!.id] },
    });
    expect(invite.status()).toBe(201);
    const token = new URL(await mailLink(admin, email, 'invite'), 'http://x').searchParams.get(
      'token',
    );
    expect(
      (
        await page.request.post('/api/auth/accept-invite', {
          data: { token, name: 'F10 Sharer', password: 'Sharer123' },
        })
      ).ok(),
    ).toBe(true);

    const [v] = await someVehicles(admin, 1, 20);
    const theirs = await apiShare(admin, v!.vehicleId);
    const mine = await apiShare(page.request, v!.vehicleId);
    await admin.dispose();

    const listed = (await (await page.request.get('/api/share-links')).json()) as ShareLink[];
    expect(listed.map((l) => l.id)).toEqual([mine.id]);
    expect(listed.map((l) => l.id)).not.toContain(theirs.id);

    await openDetails(page, v!);
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Admin' }),
    ).toHaveCount(0);
    await panel(page).getByTestId('share-cta').click();
    await dialog(page).getByRole('tab', { name: /Links/ }).click();
    const rows = dialog(page).locator('li[data-link-id]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-link-id', mine.id);
    await expect(rows.first().getByRole('button', { name: 'Revoke link' })).toBeVisible();
    await expect(rows.first()).not.toContainText('by ');

    await page.goto('/admin/share-links');
    await expect(
      page.getByRole('heading', { name: "You don't have access to this page." }),
    ).toBeVisible();
  });
});
