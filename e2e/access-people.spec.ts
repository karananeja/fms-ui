import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import type { Fleet, Permission } from '@shared/contract/index.ts';
import { adminApi, mailLink } from './auth-helpers.ts';
import { AUTH_FILE, expect, SIGNED_OUT, test } from './fixtures.ts';
import { tableTotal } from './table-helpers.ts';
import { shot, SHOTS_ON, SHOTS_SKIP_REASON } from './shots.ts';

const SHOTS = 'docs/features/f03-access-control/screenshots';
const NO_ACCESS = "You don't have access to this page.";
const PASSWORD = 'People123';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const newEmail = (tag: string) => `f03-${tag}-${uid()}@fms.local`;

async function createRole(admin: APIRequestContext, name: string, permissions: Permission[]) {
  const res = await admin.post('/api/roles', { data: { name, permissions } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const fleetsOf = async (api: APIRequestContext) =>
  (await (await api.get('/api/fleets')).json()) as Fleet[];

/**
 * Invites (API, as the super admin) and accepts on `page`'s context, which signs `page` in as
 * the new user (D-077: specs make their own users; seeded passwords never change).
 */
async function signInAsNewUser(
  page: Page,
  admin: APIRequestContext,
  permissions: Permission[],
  fleetIds?: string[],
) {
  const roleId = await createRole(admin, `F03 ${permissions.join(' ')} ${uid()}`, permissions);
  const email = newEmail('user');
  const scope = fleetIds ?? [(await fleetsOf(admin)).find((f) => f.parentId === null)!.id];
  const res = await admin.post('/api/invites', { data: { email, roleId, fleetIds: scope } });
  expect(res.status()).toBe(201);
  const token = new URL(await mailLink(admin, email, 'invite'), 'http://x').searchParams.get(
    'token',
  );
  const accepted = await page.request.post('/api/auth/accept-invite', {
    data: { token, name: 'F03 User', password: PASSWORD },
  });
  expect(accepted.ok()).toBe(true);
  return email;
}

async function mainNavLabels(page: Page) {
  const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
  await expect(links.first()).toBeVisible();
  return Promise.all((await links.all()).map((l) => l.getAttribute('aria-label')));
}

const noAccess = (page: Page) => page.getByRole('heading', { name: NO_ACCESS });

/** Waits for the worker's first complete snapshot (D-033). */
const snapshotComplete = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (globalThis as { __fmsLive?: { snapshotCompleteAt: number } }).__fmsLive
              ?.snapshotCompleteAt ?? 0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

test.describe('as invited users', () => {
  test.use({ storageState: SIGNED_OUT });

  test('F03-T5: invite (custom role + sub-fleet) → accept → only allowed pages; disable → /login', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const admin = await adminApi(baseURL!);
    const north = (await fleetsOf(admin)).find((f) => f.name === 'North')!;
    const roleName = `F03 Dispatcher ${uid()}`;
    await createRole(admin, roleName, ['live.view', 'table.view', 'users.manage']);

    // The super admin invites through the Invites page.
    const adminCtx = await browser.newContext({ storageState: AUTH_FILE, reducedMotion: 'reduce' });
    const adminPage = await adminCtx.newPage();
    const email = newEmail('t5');
    await adminPage.goto('/admin/invites');
    await adminPage.getByRole('button', { name: 'Invite user' }).click();
    const dialog = adminPage.getByRole('dialog', { name: 'Invite user' });
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption({ label: roleName });
    await dialog.getByLabel('Fleet scope').getByText('North', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog).toBeHidden();
    await expect(adminPage.getByRole('table', { name: 'Invites' })).toContainText(email);

    // Accept through F02.
    await page.goto(await mailLink(admin, email, 'invite'));
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await page.getByLabel('Name').fill('F03 Dispatcher');
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/live-tracking$/);
    const me = (await (await page.request.get('/api/auth/me')).json()) as { fleetIds: string[] };
    expect(me.fleetIds).toEqual([north.id]);

    // Only the allowed nav items and pages.
    expect(await mainNavLabels(page)).toEqual(['Live tracking', 'Admin', 'Users']);
    for (const path of ['/admin/roles', '/admin/invites', '/admin/fleets']) {
      await page.goto(path);
      await expect(noAccess(page)).toBeVisible();
    }
    await page.goto('/admin/users');
    await expect(page.getByRole('table', { name: 'Users' })).toContainText(email);

    // The super admin disables them while they're signed in.
    await adminPage.goto('/admin/users');
    await adminPage.getByLabel('Search users').fill(email);
    await adminPage
      .getByRole('table', { name: 'Users' })
      .getByText('F03 Dispatcher', { exact: true })
      .click();
    const panel = adminPage.getByRole('dialog', { name: 'F03 Dispatcher' });
    await panel.getByRole('button', { name: 'Disabled' }).click();
    await panel.getByRole('button', { name: 'Save changes' }).click();
    const confirm = adminPage.getByRole('alertdialog', { name: 'Disable F03 Dispatcher?' });
    await expect(confirm).toContainText('They will be signed out now.');
    await confirm.getByRole('button', { name: 'Disable' }).click();
    await expect(adminPage.getByRole('table', { name: 'Users' })).toContainText('Disabled');

    // Their next request lands on /login.
    const adminLink = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Admin', exact: true });
    if (await adminLink.isVisible()) await adminLink.click().catch(() => {});
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await adminCtx.close();
    await admin.dispose();
  });

  test('F03-T6: without vehicle.parameters.view the Parameters tab is hidden', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const admin = await adminApi(baseURL!);
    await signInAsNewUser(page, admin, ['live.view', 'vehicle.details.view', 'table.view']);
    const [v] = (
      (await (await admin.get('/api/vehicles?limit=1')).json()) as {
        items: { vehicleId: string; regno: string }[];
      }
    ).items;
    await admin.dispose();

    await page.goto('/live-tracking?debug=1');
    await snapshotComplete(page);
    await page.getByLabel('Select vehicle').fill(v!.vehicleId);
    await page.getByRole('button', { name: 'Select' }).click();
    const details = page.getByRole('region', { name: 'Vehicle details' });
    await expect(details.getByTestId('details-regno')).toHaveText(v!.regno, { timeout: 15_000 });
    await expect(details.getByRole('tab', { name: /Overview/ })).toBeVisible();
    await expect(details.getByRole('tab', { name: /Parameters/ })).toHaveCount(0);
  });

  test('F03-T6: without table.view there is no table button and ?view=table shows the map', async ({
    page,
    baseURL,
  }) => {
    const admin = await adminApi(baseURL!);
    await signInAsNewUser(page, admin, ['live.view', 'vehicle.details.view']);
    await admin.dispose();

    await page.goto('/live-tracking?view=table');
    await expect(page.getByRole('toolbar', { name: 'Map tools' })).toBeVisible();
    await expect(page.getByTestId('live-map')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Table view' })).toHaveCount(0);
    await expect(page.getByTestId('table-view')).toHaveCount(0);
  });

  test('F03-T6: without table.export the table has no Export CSV', async ({ page, baseURL }) => {
    const admin = await adminApi(baseURL!);
    await signInAsNewUser(page, admin, ['live.view', 'table.view']);
    await admin.dispose();

    await page.goto('/live-tracking');
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.getByTestId('table-view')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Columns' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  });

  test('F03-T6: without live.view: lands on admin, No access on the map, no live worker', async ({
    page,
    baseURL,
  }) => {
    let sockets = 0;
    let workers = 0;
    page.on('websocket', (ws) => {
      if (ws.url().includes('/ws/live')) sockets++;
    });
    page.on('worker', () => workers++);
    const admin = await adminApi(baseURL!);
    await signInAsNewUser(page, admin, ['users.manage']);
    await admin.dispose();

    await page.goto('/');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('link', { name: 'Users' }).first()).toBeVisible();
    expect(await mainNavLabels(page)).toEqual(['Admin', 'Users']);
    await page.goto('/live-tracking');
    await expect(noAccess(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to admin' })).toBeVisible();
    await shot(page, { path: `${SHOTS}/no-access.png` });
    await page.waitForTimeout(500);
    expect({ sockets, workers }).toEqual({ sockets: 0, workers: 0 });
  });

  test('F03-T7: ops@fms.local (North) sees only North: map, table, CSV, filter panel', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const login = await page.request.post('/api/auth/login', {
      data: { email: 'ops@fms.local', password: 'Ops@1234' },
    });
    expect(login.ok()).toBe(true);

    // The scope from /api/fleets, cross-checked against the full tree.
    const scoped = await fleetsOf(page.request);
    const admin = await adminApi(baseURL!);
    const all = await fleetsOf(admin);
    await admin.dispose();
    const north = all.find((f) => f.name === 'North')!;
    const subtree = new Set([north.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of all)
        if (f.parentId && subtree.has(f.parentId) && !subtree.has(f.id)) {
          subtree.add(f.id);
          grew = true;
        }
    }
    expect(new Set(scoped.map((f) => f.id))).toEqual(subtree);
    const total = scoped.find((f) => f.id === north.id)!.vehicleCount;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(all.find((f) => f.parentId === null)!.vehicleCount);

    // Map: the fleet pulse total.
    await page.goto('/live-tracking');
    await snapshotComplete(page);
    await expect
      .poll(
        async () =>
          Number((await page.getByTestId('pulse-total').textContent())?.replace(/\D/g, '')),
        {
          timeout: 15_000,
        },
      )
      .toBe(total);

    // Filter panel: only North's subtree, North first.
    await page.getByRole('button', { name: 'Filters' }).click();
    const tree = page.getByRole('tree', { name: 'Fleets' });
    await expect(tree.getByRole('treeitem')).toHaveCount(subtree.size);
    await expect(tree.getByRole('treeitem').first()).toContainText('North');
    await page.keyboard.press('Escape');

    // Table total and CSV rows.
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect.poll(() => tableTotal(page), { timeout: 15_000 }).toBe(total);
    const downloading = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const csv = readFileSync((await (await downloading).path())!, 'utf8');
    const rows = csv.split(/\r?\n/).filter((l) => l.length > 0).length - 1;
    expect(rows).toBe(total);
  });
});

test.describe('UAT screenshots (super admin)', () => {
  test.skip(!SHOTS_ON, SHOTS_SKIP_REASON);
  test('F03-T9: admin overview, users + panel, invites + dialog, roles + editor', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    // A couple of pending invites so the list has rows.
    const admin = await adminApi(baseURL!);
    const north = (await fleetsOf(admin)).find((f) => f.name === 'North')!;
    for (const roleId of ['role-viewer', 'role-operator']) {
      const res = await admin.post('/api/invites', {
        data: { email: newEmail('uat'), roleId, fleetIds: [north.id] },
      });
      expect(res.status()).toBe(201);
    }
    await admin.dispose();
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Pending invites' })).toContainText('pending');
    await expect(page.getByRole('link', { name: 'Users' }).last()).toContainText('active');
    await shot(page, { path: `${SHOTS}/admin-overview.png` });

    await page.goto('/admin/users');
    const users = page.getByRole('table', { name: 'Users' });
    await expect(users).toContainText('ops@fms.local');
    await shot(page, { path: `${SHOTS}/users.png` });
    await users.getByText('Ops User').click();
    await expect(page.getByRole('dialog', { name: 'Ops User' })).toBeVisible();
    await shot(page, { path: `${SHOTS}/users-panel.png` });
    await page.keyboard.press('Escape');
    await users.getByText('Super Admin', { exact: true }).first().click();
    await expect(page.getByText("You can't change your own role.")).toBeVisible();
    await shot(page, { path: `${SHOTS}/users-panel-self.png` });
    await page.keyboard.press('Escape');

    await page.goto('/admin/invites');
    await expect(page.getByRole('table', { name: 'Invites' })).toContainText('Pending');
    await shot(page, { path: `${SHOTS}/invites.png` });
    await page.getByRole('button', { name: 'Invite user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite user' });
    await dialog.getByLabel('Email').fill('ops@fms.local');
    await dialog.getByLabel('Role').selectOption({ label: 'Viewer' });
    await dialog.getByLabel('Fleet scope').getByText('North', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('A user with this email already exists')).toBeVisible();
    await shot(page, { path: `${SHOTS}/invites-dialog.png` });
    await page.keyboard.press('Escape');

    await page.goto('/admin/roles');
    const roles = page.getByRole('table', { name: 'Roles' });
    await expect(roles).toContainText('Operator');
    await shot(page, { path: `${SHOTS}/roles.png` });
    await roles.getByText('Operator', { exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Operator' });
    await expect(editor.getByRole('checkbox', { name: 'Invite users' })).toBeDisabled();
    await shot(page, { path: `${SHOTS}/roles-editor.png` });
    // R14 via the UI path: deleting a role in use shows the server's 409.
    await editor.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete Operator?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(editor.getByRole('alert')).toContainText('Role is assigned');
  });

  test('F03-T9: mobile users list and bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/users');
    const users = page.getByRole('table', { name: 'Users' });
    await expect(users).toContainText('Ops User');
    await shot(page, { path: `${SHOTS}/users-mobile.png` });
    await users.getByText('Ops User').click();
    const sheet = page.getByRole('dialog', { name: 'Ops User' });
    await expect(sheet).toHaveAttribute('data-side-panel', 'sheet');
    await shot(page, { path: `${SHOTS}/users-mobile-panel.png` });
  });
});
