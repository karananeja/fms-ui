import type { APIRequestContext, Page } from '@playwright/test';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * F26 e2e (fake model, super admin): custom widgets built from a prompt → preview card → Add,
 * each persisting after a reload; a follow map asks for the vehicle first; scope per viewer.
 */

const SHOTS = 'docs/features/f26-dynamic-widgets/screenshots';
const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });

type Dash = { id: string; widgets: { id: string; type: string; title: string }[] };

async function seed(api: APIRequestContext, title: string, widgets: object[] = []): Promise<Dash> {
  const res = await api.post('/api/dashboards', {
    data: { title, widgets: [{ type: 'text', title: 'Alpha', body: 'Note' }, ...widgets] },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Dash;
}
const read = async (api: APIRequestContext, id: string) =>
  (await (await api.get(`/api/dashboards/${id}`)).json()) as Dash;

async function say(page: Page, id: string, message: string) {
  const res = page.waitForResponse((r) => r.url().endsWith(`/api/dashboards/${id}/chat`));
  await box(page).fill(message);
  await box(page).press('Enter');
  await (await res).finished();
  await expect(page.getByTestId('assistant-message').last()).toHaveAttribute('data-status', 'done');
}

/** Sends a prompt, checks the newest preview card, adds it; returns the card. */
async function previewAndAdd(page: Page, id: string, prompt: string, title: RegExp | string) {
  const before = await page.getByTestId('widget-preview').count();
  await say(page, id, prompt);
  const card = page.getByTestId('widget-preview').nth(before);
  await expect(card.getByRole('heading', { name: title })).toBeVisible();
  return card;
}

const item = (page: Page, title: RegExp | string) =>
  page.locator('.react-grid-item').filter({ has: page.getByRole('heading', { name: title }) });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('fms.dashboards.chat', 'open'));
});

test('F26-T6: live map of low-battery vehicles coloured by status; markers update; persists', async ({
  page,
}) => {
  const d = await seed(page.request, 'F26 map');
  try {
    await page.goto(`/dashboards/${d.id}`);
    // The simulator keeps SOC ≥ ~20 %, so "low" is under 40 % here.
    const TITLE = 'Battery under 40%';
    const card = await previewAndAdd(
      page,
      d.id,
      'show vehicles with battery under 40% on a map, coloured by status',
      TITLE,
    );
    const pmap = card.getByTestId('custom-map');
    await expect(pmap).toBeVisible();
    await expect.poll(async () => Number(await pmap.getAttribute('data-points'))).toBeGreaterThan(0);
    expect((await read(page.request, d.id)).widgets).toHaveLength(1);
    await card.getByTestId('preview-add').click();
    await expect(card.getByTestId('preview-added')).toHaveText('Added ✓');

    const map = item(page, TITLE).getByTestId('custom-map');
    await expect(map).toBeVisible();
    const first = Number((await map.getAttribute('data-updates')) ?? 0);
    // Live data: the point set changes as vehicles move / charge (≤ 1 Hz).
    await expect
      .poll(async () => Number((await map.getAttribute('data-updates')) ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(first);
    await shot(page, { path: `${SHOTS}/f26-t6-low-battery-map.png` });

    const saved = await read(page.request, d.id);
    expect(saved.widgets.map((w) => w.type)).toEqual(['text', 'custom']);
    await page.reload();
    const after = item(page, TITLE).getByTestId('custom-map');
    await expect(after).toBeVisible();
    await expect.poll(async () => Number(await after.getAttribute('data-points'))).toBeGreaterThan(0);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('F26-T8 + T7: top-10 table, breakdowns bar → line, follow map with a trail; all persist', async ({
  page,
}) => {
  const d = await seed(page.request, 'F26 build');
  try {
    await page.goto(`/dashboards/${d.id}`);

    // Top-10 table.
    const table = await previewAndAdd(page, d.id, 'top 10 fastest vehicles as a table', 'Top 10 fastest vehicles');
    await expect(table.getByTestId('custom-row')).toHaveCount(10);
    await table.getByTestId('preview-add').click();
    const rows = item(page, 'Top 10 fastest vehicles').getByTestId('custom-row');
    await expect(rows).toHaveCount(10);
    const regno = (await rows.first().locator('td').first().textContent())!.trim();
    expect(regno).toMatch(/^[A-Z0-9]+$/);

    // Breakdowns per fleet over 7 days as bars, then "change it to a line chart".
    const bar = await previewAndAdd(page, d.id, 'breakdowns per fleet this week as a bar chart', /Breakdowns per fleet/);
    await expect(bar.getByTestId('custom-chart')).toHaveAttribute('data-kind', 'bar');
    await expect(bar.getByTestId('chart-table').locator('tbody tr').first()).toBeAttached();
    await bar.getByTestId('preview-add').click();
    await expect(item(page, /Breakdowns per fleet/).getByTestId('custom-chart')).toHaveAttribute('data-kind', 'bar');
    const line = await previewAndAdd(page, d.id, 'change it to a line chart', /Breakdowns per day/);
    await expect(line.getByTestId('custom-chart')).toHaveAttribute('data-kind', 'line');
    await line.getByTestId('preview-add').click();
    await expect(item(page, /Breakdowns per day/).getByTestId('custom-chart')).toHaveAttribute('data-kind', 'line');

    // Follow: without a vehicle the assistant asks which one (no preview).
    const cards = await page.getByTestId('widget-preview').count();
    await say(page, d.id, 'create a widget with vehicle on the map tracking its location and movement in live mode');
    await expect(page.getByTestId('assistant-message').last()).toContainText('Which vehicle should I follow?');
    await expect(page.getByTestId('widget-preview')).toHaveCount(cards);

    const follow = await previewAndAdd(page, d.id, `track ${regno} live on the map with its movement`, `Tracking ${regno}`);
    await expect(follow.getByTestId('custom-map')).toHaveAttribute('data-follow', regno);
    await follow.getByTestId('preview-add').click();
    const fmap = item(page, `Tracking ${regno}`).getByTestId('custom-map');
    await expect(fmap).toHaveAttribute('data-follow', regno);
    await expect.poll(async () => Number(await fmap.getAttribute('data-trail')), { timeout: 15_000 }).toBeGreaterThan(1);
    await shot(page, { path: `${SHOTS}/f26-t8-built.png` });

    const saved = await read(page.request, d.id);
    expect(saved.widgets.filter((w) => w.type === 'custom').map((w) => w.title)).toEqual([
      'Top 10 fastest vehicles',
      'Breakdowns per fleet (7 days)',
      'Breakdowns per day (7 days)',
      `Tracking ${regno}`,
    ]);
    await page.reload();
    await expect(page.locator('.react-grid-item')).toHaveCount(5);
    await expect(item(page, 'Top 10 fastest vehicles').getByTestId('custom-row')).toHaveCount(10);
    await expect(item(page, /Breakdowns per fleet/).getByTestId('custom-chart')).toHaveAttribute('data-kind', 'bar');
    await expect(item(page, /Breakdowns per day/).getByTestId('custom-chart')).toHaveAttribute('data-kind', 'line');
    // Off-screen maps stay paused (D-146): scroll the follow map into view first.
    const tracked = item(page, `Tracking ${regno}`);
    await tracked.scrollIntoViewIfNeeded();
    await expect(tracked.getByTestId('custom-map')).toHaveAttribute('data-follow', regno);
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('F26-T9: a viewer with fewer fleets sees fewer vehicles on the same dashboard', async ({
  page,
  browser,
  baseURL,
}) => {
  const d = await seed(page.request, 'F26 scope', [
    { type: 'custom', title: 'All vehicles', spec: { data: { dataset: 'live-vehicles' }, mark: { type: 'number' } } },
  ]);
  try {
    const ops = (await (await page.request.get('/api/dashboards/share-candidates?q=ops')).json()) as {
      userId: string;
      email: string;
    }[];
    const opsId = ops.find((u) => u.email === 'ops@fms.local')!.userId;
    expect((await page.request.post(`/api/dashboards/${d.id}/shares`, { data: { userIds: [opsId] } })).ok()).toBe(true);

    await page.goto(`/dashboards/${d.id}`);
    const mine = item(page, 'All vehicles').getByTestId('custom-number');
    await expect.poll(async () => Number(await mine.getAttribute('data-total'))).toBeGreaterThan(0);
    const adminTotal = Number(await mine.getAttribute('data-total'));

    const ctx = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
    const op = await ctx.newPage();
    await op.request.post('/api/auth/login', { data: { email: 'ops@fms.local', password: 'Ops@1234' } });
    await op.goto(`/dashboards/${d.id}`);
    const theirs = item(op, 'All vehicles').getByTestId('custom-number');
    await expect.poll(async () => Number(await theirs.getAttribute('data-total')), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(Number(await theirs.getAttribute('data-total'))).toBeLessThan(adminTotal);
    await ctx.close();
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
