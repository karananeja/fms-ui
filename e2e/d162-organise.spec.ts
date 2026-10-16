import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * D-162 (super admin, fake model): "Organise" re-packs a messy dashboard (tiles first, rows edge
 * to edge) and is undoable; a widget added from a chat preview is scrolled into view.
 */

const SHOTS = 'docs/features/f20-dashboards-ui/screenshots';
const tag = () => `d162${Math.random().toString(36).slice(2, 8)}`;
type Item = { i: string; x: number; y: number; w: number; h: number };
type Dash = { id: string; version: number; widgets: { id: string; type: string }[]; layout: { lg: Item[] } };
const read = async (api: APIRequestContext, id: string) =>
  (await (await api.get(`/api/dashboards/${id}`)).json()) as Dash;
const box = (page: Page) => page.getByRole('textbox', { name: 'Message the assistant' });

test('D-162-T1: Organise packs a staircase layout; Undo restores it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const widgets = [
    { type: 'vehicle-list', title: 'Vehicles', filter: { statuses: ['no-gps'] }, columns: ['regno', 'status'], sort: { column: 'regno', dir: 'asc' }, limit: 10 },
    { type: 'kpi', title: 'Running', source: 'live', status: 'running' },
    { type: 'daily-chart', title: 'Distance', chart: 'bar', metrics: ['distanceKm'], range: '7d' },
    { type: 'kpi', title: 'Stopped', source: 'live', status: 'stopped' },
  ];
  const d = (await (await page.request.post('/api/dashboards', { data: { title: `Messy ${tag()}`, widgets } })).json()) as Dash;
  try {
    // A staircase: one widget per row, each pushed to the right.
    const lg = d.widgets.map((w, k) => ({ i: w.id, x: k * 2, y: k * 6, w: 4, h: 5 }));
    const res = await page.request.patch(`/api/dashboards/${d.id}`, {
      data: { version: d.version, layout: { lg, md: lg.map((l) => ({ ...l, x: 0, w: 6 })), sm: lg.map((l) => ({ ...l, x: 0, w: 1 })) } },
    });
    expect(res.ok()).toBe(true);
    await page.goto(`/dashboards/${d.id}`);
    await expect(page.locator('.react-grid-item')).toHaveCount(4);

    await page.getByTestId('action-organise').click();
    await expect(page.getByText('Widgets organised')).toBeVisible();
    await expect.poll(async () => (await read(page.request, d.id)).version).toBe(d.version + 2);
    const packed = (await read(page.request, d.id)).layout.lg;
    const at = (type: string) => packed.filter((l) => d.widgets.find((w) => w.id === l.i)!.type === type);
    // KPIs share the top row, full width; the chart and the list each fill a row below.
    expect(at('kpi').map((l) => l.y)).toEqual([0, 0]);
    expect(at('kpi').reduce((n, l) => n + l.w, 0)).toBe(12);
    expect(at('daily-chart')[0]).toMatchObject({ x: 0, w: 12 });
    expect(at('vehicle-list')[0]!.y).toBeGreaterThan(at('daily-chart')[0]!.y);
    await shot(page, { path: `${SHOTS}/d162-organised.png` });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await read(page.request, d.id)).layout.lg.map((l) => [l.x, l.y])).toEqual(
      lg.map((l) => [l.x, l.y]),
    );
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});

test('D-162-T2: a widget added from a chat preview is scrolled into view and outlined', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('fms.dashboards.chat', 'open'));
  const tall = Array.from({ length: 4 }, (_, k) => ({ type: 'vehicle-list', title: `List ${k}`, filter: { statuses: ['no-gps'] }, columns: ['regno', 'status'], sort: { column: 'regno', dir: 'asc' }, limit: 10 }));
  const d = (await (await page.request.post('/api/dashboards', { data: { title: `Add ${tag()}`, widgets: tall } })).json()) as Dash;
  try {
    await page.goto(`/dashboards/${d.id}`);
    await expect(page.locator('.react-grid-item')).toHaveCount(4);
    await box(page).fill('top 10 fastest vehicles as a table');
    await box(page).press('Enter');
    const card = page.getByTestId('widget-preview').last();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId('preview-add').click();
    const added = page.locator('[data-activity-highlight]');
    await expect(added).toContainText('Top 10 fastest vehicles');
    await expect(added).toBeInViewport();
  } finally {
    await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
