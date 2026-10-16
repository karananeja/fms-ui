import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { shot } from './shots.ts';

/**
 * D-160 (super admin): one vehicle's live readings in ONE `instrument` widget: header with regno
 * and status, gauges for speed and SOC, readouts for the rest; persists after a reload.
 */

const SHOTS = 'docs/features/f26-dynamic-widgets/screenshots';
const tag = () => `d160${Math.random().toString(36).slice(2, 8)}`;

async function seed(api: APIRequestContext, widgets: object[]) {
  const res = await api.post('/api/dashboards', {
    data: { title: `Instrument ${tag()}`, widgets },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
const item = (page: Page, title: string) =>
  page.locator('.react-grid-item').filter({ has: page.getByRole('heading', { name: title }) });

test('D-160-T1: instrument widget shows one vehicle: gauges + readouts, live, persists', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A live table tells us a real regno.
  const probe = await seed(page.request, [
    {
      type: 'custom',
      title: 'Probe',
      spec: {
        data: { dataset: 'live-vehicles' },
        shape: { limit: 1 },
        mark: { type: 'table', columns: ['regno'] },
      },
    },
  ]);
  let d: { id: string } | null = null;
  try {
    await page.goto(`/dashboards/${probe.id}`);
    const cell = item(page, 'Probe').getByTestId('custom-row').first().locator('td').first();
    await expect(cell).toHaveText(/^[A-Z0-9]+$/);
    const regno = (await cell.textContent())!.trim();

    d = await seed(page.request, [
      {
        type: 'custom',
        title: `${regno} cluster`,
        spec: {
          data: {
            dataset: 'live-vehicles',
            filter: { all: [{ field: 'regno', op: 'eq', value: regno }] },
          },
          mark: {
            type: 'instrument',
            columns: ['speed', 'soc', 'dte', 'odometer', 'ignition', 'gpstime'],
          },
        },
      },
    ]);
    await page.goto(`/dashboards/${d.id}`);
    const widget = item(page, `${regno} cluster`);
    const inst = widget.getByTestId('custom-instrument');
    await expect(inst).toContainText(regno);
    await expect(inst.getByTestId('instrument-status')).not.toBeEmpty();
    await expect(inst.getByTestId('instrument-gauge')).toHaveCount(2);
    await expect(
      inst.locator('[data-testid="instrument-gauge"][data-field="speed"]'),
    ).toBeVisible();
    await expect(inst.locator('[data-testid="instrument-gauge"][data-field="soc"]')).toBeVisible();
    await expect(inst.getByTestId('instrument-readout')).toHaveCount(4);
    await expect(inst.locator('[data-field="dte"]')).toContainText('Range');
    await expect(page.locator('.react-grid-item')).toHaveCount(1);
    await shot(page, { path: `${SHOTS}/d160-instrument.png` });

    await page.reload();
    await expect(item(page, `${regno} cluster`).getByTestId('instrument-gauge')).toHaveCount(2);
  } finally {
    await page.request.delete(`/api/dashboards/${probe.id}`);
    if (d) await page.request.delete(`/api/dashboards/${d.id}`);
  }
});
