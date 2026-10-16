import type { APIRequestContext } from '@playwright/test';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * D-161 (super admin + Ops User as editor): a dashboard's Activity list is actionable: Undo just
 * one entry (later work stays), Restore to before an entry (with a confirm), each recorded.
 */

const SHOTS = 'docs/features/f27-dashboard-edit-sharing/screenshots';
const tag = () => `d161${Math.random().toString(36).slice(2, 8)}`;
type Dash = { id: string; version: number; widgets: { id: string; title: string }[] };

const read = async (api: APIRequestContext, id: string) =>
  (await (await api.get(`/api/dashboards/${id}`)).json()) as Dash;
async function patch(api: APIRequestContext, id: string, body: object) {
  const { version } = await read(api, id);
  const res = await api.patch(`/api/dashboards/${id}`, { data: { version, ...body } });
  expect(res.ok()).toBe(true);
}

test('D-161-T1: Activity entries: Undo one change, Restore to before an entry', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('/api/dashboards', {
    data: {
      title: `Board ${tag()}`,
      widgets: [
        { type: 'text', title: 'Alpha', body: 'A' },
        { type: 'text', title: 'Beta', body: 'B' },
      ],
    },
  });
  const d = (await res.json()) as Dash;
  await page.request.post(`/api/dashboards/${d.id}/shares`, {
    data: { userIds: ['u-ops'], access: 'edit' },
  });
  const ops = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
  try {
    const login = await ops.request.post('/api/auth/login', {
      data: { email: 'ops@fms.local', password: 'Ops@1234' },
    });
    expect(login.ok()).toBe(true);
    // Ops removes Alpha, then the owner renames the board.
    const beta = d.widgets.find((w) => w.title === 'Beta')!;
    await patch(ops.request, d.id, { widgets: [beta] });
    await patch(page.request, d.id, { title: 'Renamed board' });

    await page.goto(`/dashboards/${d.id}`);
    await expect(page.locator('.react-grid-item')).toHaveCount(1);
    await page.getByTestId('activity-button').click();
    const items = page.getByTestId('activity-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText('Removed 1 widget');
    await expect(items.nth(1).getByTestId('activity-restore')).toBeVisible();
    await shot(page, { path: `${SHOTS}/d161-activity.png` });

    // Undo the removal only: Alpha is back, the rename stays.
    await items.nth(1).getByTestId('activity-undo').click();
    await expect(page.locator('.react-grid-item')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await expect(page.getByTestId('dashboard-title')).toContainText('Renamed board');
    await expect(items.first()).toContainText('Undid: Removed 1 widget');
    await expect(page.locator('[data-testid="activity-item"][data-undone]')).toHaveCount(1);
    // Show outlines the widget the undo brought back.
    await items.first().getByTestId('activity-show').click();
    await expect(page.locator('[data-activity-highlight]')).toContainText('Alpha');

    // Restore to before the rename (reverts the later undo too, after a confirm).
    const rename = items.filter({ hasText: 'Renamed to' });
    await rename.getByTestId('activity-restore').click();
    await expect(rename.getByTestId('activity-confirm')).toContainText('also reverts 1 later change');
    await rename.getByTestId('activity-restore-confirm').click();
    await expect(page.getByTestId('dashboard-title')).not.toContainText('Renamed board');
    await expect(page.locator('.react-grid-item')).toHaveCount(1);
    await expect(items.first()).toContainText('Restored to before: Renamed to');
  } finally {
    await ops.close();
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
