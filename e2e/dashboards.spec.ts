import type { APIRequestContext, Page } from '@playwright/test';
import { adminApi, createUser } from './auth-helpers.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/** F20 e2e: list + empty state, grid editing persistence, title bar actions, sharing. */

const PASSWORD = 'Dash1234!x';
const SHOTS = 'docs/features/f20-dashboards-ui/screenshots';

test.use({ storageState: SIGNED_OUT });

/** A brand-new Operator (root fleet, dashboards.use + chat.use), signed in on `page`. */
async function freshOwner(page: Page, baseURL: string): Promise<string> {
  const admin = await adminApi(baseURL);
  const email = await createUser(baseURL, admin, PASSWORD);
  await admin.dispose();
  expect((await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })).ok()).toBe(true);
  return email;
}

const TEXT = (title: string) => ({ type: 'text', title, body: `Note **${title}**` });

async function seed(api: APIRequestContext, title: string, widgets: object[]) {
  const res = await api.post('/api/dashboards', { data: { title, widgets } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; widgets: { id: string; title: string }[] };
}

const layoutOf = async (api: APIRequestContext, id: string) =>
  ((await (await api.get(`/api/dashboards/${id}`)).json()) as {
    layout: { lg: { i: string; x: number; y: number; w: number; h: number }[] };
  }).layout.lg;

test('F20-T8: empty state, Start blank, nav item; viewer has no Dashboards', async ({ page, baseURL }) => {
  await freshOwner(page, baseURL!);
  await page.goto('/dashboards');
  await expect(page.getByRole('link', { name: 'Dashboards' }).first()).toBeVisible();
  const empty = page.getByTestId('dashboards-empty');
  await expect(empty.getByText('Ask FMS to build your first dashboard')).toBeVisible();
  await page.getByTestId('example-prompt').first().click();
  await expect(page.getByLabel('Describe the dashboard you want')).toHaveValue(/running, idle and stopped/);
  await shot(page, { path: `${SHOTS}/f20-empty-state.png` });
  await empty.getByRole('button', { name: 'Start blank' }).click();
  await expect(page).toHaveURL(/\/dashboards\/[^/?]+$/);
  await expect(page.getByTestId('dashboard-empty')).toContainText('Ask FMS to add widgets');
  await expect(page.getByRole('textbox', { name: 'Message the assistant' })).toBeVisible();

  const viewer = await page.context().browser()!.newContext({ storageState: SIGNED_OUT, baseURL });
  const vp = await viewer.newPage();
  await vp.request.post('/api/auth/login', { data: { email: 'viewer@fms.local', password: 'View@1234' } });
  await vp.goto('/live-tracking');
  await expect(vp.getByRole('link', { name: 'Live tracking' }).first()).toBeAttached();
  await expect(vp.getByRole('link', { name: 'Dashboards' })).toHaveCount(0);
  await viewer.close();
});

test('F20-T10: drag, resize and keyboard move persist after a reload (lg, dock collapsed)', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshOwner(page, baseURL!);
  await page.addInitScript(() => localStorage.setItem('fms.dashboards.chat', 'closed'));
  const d = await seed(page.request, 'Layout test', [TEXT('Alpha'), TEXT('Beta'), TEXT('Gamma')]);
  const before = await layoutOf(page.request, d.id);
  await page.goto(`/dashboards/${d.id}`);
  const grid = page.getByTestId('dashboard-grid');
  await expect(grid).toHaveAttribute('data-breakpoint', 'lg');
  await expect(page.locator('.react-grid-item')).toHaveCount(3);

  const item = (title: string) =>
    page.locator('.react-grid-item').filter({ has: page.getByRole('heading', { name: title }) });
  // Drag Alpha by its title (the handle) to the far right of the row below.
  const title = item('Alpha').getByTestId('widget-title');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 12 });
  await page.mouse.move(box.x + 620, box.y + 260, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 5000 });

  // Resize Beta from its bottom-right handle.
  const handle = item('Beta').locator('.react-resizable-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 90, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 5000 });

  // Keyboard: grab Gamma, move one column left, drop.
  const grip = item('Gamma').getByTestId('widget-handle');
  await grip.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('arrange-status')).toContainText('Moved to column');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/, { timeout: 5000 });

  const after = await layoutOf(page.request, d.id);
  const by = (l: typeof after, i: number) => l.find((x) => x.i === d.widgets[i]!.id)!;
  expect(by(after, 0)).not.toMatchObject({ x: by(before, 0).x, y: by(before, 0).y });
  expect(by(after, 1).w * by(after, 1).h).toBeGreaterThan(by(before, 1).w * by(before, 1).h);
  expect(by(after, 2).x).not.toBe(by(before, 2).x);

  await page.reload();
  await expect(page.locator('.react-grid-item')).toHaveCount(3);
  expect(await layoutOf(page.request, d.id)).toEqual(after);
});

test('F20-T11: rename, duplicate and delete', async ({ page, baseURL }) => {
  await freshOwner(page, baseURL!);
  const d = await seed(page.request, 'Ops board', [TEXT('Note')]);
  await page.goto(`/dashboards/${d.id}`);
  await page.getByTestId('dashboard-title').click();
  await page.getByLabel('Dashboard title').fill('Ops board 2');
  await page.getByLabel('Dashboard title').press('Enter');
  await expect(page.getByRole('heading', { name: 'Ops board 2' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText(/^Saved/);

  await page.getByTestId('action-duplicate').click();
  await expect(page.getByRole('heading', { name: 'Ops board 2 (copy)' })).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(d.id));

  await page.getByTestId('action-delete').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText("Delete 'Ops board 2 (copy)'?");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('action-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/dashboards$/);
  const cards = page.getByTestId('dashboard-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByTestId('card-title')).toHaveText('Ops board 2');

  // Rename from the card menu.
  await cards.first().getByTestId('card-menu').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Title').fill('Renamed on card');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(cards.first().getByTestId('card-title')).toHaveText('Renamed on card');
  await shot(page, { path: `${SHOTS}/f20-list.png` });
});

test('F20-T12: share read-only with the super admin, then revoke', async ({ page, baseURL, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshOwner(page, baseURL!);
  const d = await seed(page.request, 'Shared board', [
    TEXT('Readme'),
    { type: 'status-breakdown', title: 'Fleet status', display: 'donut' },
    { type: 'kpi', title: 'Running now', source: 'live', status: 'running' },
  ]);
  await page.goto(`/dashboards/${d.id}`);
  await expect(page.getByTestId('status-breakdown')).toBeVisible({ timeout: 20_000 });
  await shot(page, { path: `${SHOTS}/f20-dashboard-dark.png` });
  await page.getByTestId('action-share').click();
  const dlg = page.getByTestId('share-dialog');
  await dlg.getByRole('searchbox').fill('Super');
  await dlg.getByRole('checkbox', { name: /Super Admin/ }).check();
  await dlg.getByRole('button', { name: /^Share/ }).click();
  await expect(dlg.getByTestId('share-person')).toHaveCount(1);
  await shot(page, { path: `${SHOTS}/f20-share-dialog.png` });
  await page.keyboard.press('Escape');

  // The super admin (default signed-in state) sees it under "Shared with me", read-only.
  const sa = await browser.newContext({ storageState: 'e2e/.auth/super-admin.json', baseURL });
  const sp = await sa.newPage();
  await sp.goto('/dashboards?tab=shared');
  const card = sp.getByTestId('dashboard-card').filter({ hasText: 'Shared board' });
  await expect(card.getByTestId('card-badge')).toContainText('Shared by');
  await card.getByRole('link').click();
  await expect(sp.getByTestId('view-only-badge')).toBeVisible();
  await expect(sp.locator('.react-grid-item')).toHaveCount(3);
  await expect(sp.getByTestId('widget-handle')).toHaveCount(0);
  await expect(sp.getByTestId('chat-dock')).toHaveCount(0);
  await sp.getByTestId('widget-menu').first().click();
  await expect(sp.getByRole('menuitem')).toHaveText(['Refresh']);
  await sp.keyboard.press('Escape');

  // Owner revokes → the viewer's reload shows the 404 state.
  const shares = (await (await page.request.get(`/api/dashboards/${d.id}/shares`)).json()) as {
    userId: string;
  }[];
  expect((await page.request.delete(`/api/dashboards/${d.id}/shares/${shares[0]!.userId}`)).status()).toBe(204);
  await sp.reload();
  await expect(sp.getByTestId('dashboard-not-found')).toBeVisible();
  await sa.close();
});
