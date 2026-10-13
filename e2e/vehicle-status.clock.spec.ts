import { expect, test, type Page } from '@playwright/test';

const VEHICLES = 100_000;
const OFFSET_MS = 31 * 60_000;
type El = { textContent: string | null; getAttribute(name: string): string | null };
type Doc = { querySelector(selector: string): El | null };

const STATUSES = [
  'running',
  'stopped',
  'immobilized',
  'non-comm',
  'charging',
  'pullout',
  'no-gps',
  'gps-never',
];

/** Reads every status count, the total and the server offset in one DOM pass (one render). */
const readPanel = (page: Page) =>
  page.evaluate((statuses) => {
    const document = (globalThis as unknown as { document: Doc }).document;
    const num = (id: string) =>
      Number(document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/,/g, ''));
    const counts = Object.fromEntries(statuses.map((s) => [s, num(`status-count-${s}`)]));
    const offset = document.querySelector('[data-testid="live-server-offset"]');
    return {
      counts,
      sum: Object.values(counts).reduce((a, b) => a + b, 0),
      total: num('status-total'),
      offsetMs: Number(offset?.getAttribute('data-ms')),
    };
  }, STATUSES);

test.afterEach(async ({ request }) => {
  await request.post('/api/dev/clock', { data: { offsetMs: 0 } });
});

test('F05-T8: status counts sum to 1 lakh and the worker follows the server clock', async ({
  page,
  request,
}) => {
  await page.goto('/live-tracking');
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  await expect(page.getByTestId('status-total')).toHaveText(
    new Intl.NumberFormat('en-IN').format(VEHICLES),
    { timeout: 10_000 },
  );
  const before = await readPanel(page);
  expect(before.total).toBe(VEHICLES);
  expect(before.sum).toBe(VEHICLES);

  expect((await request.post('/api/dev/clock', { data: { offsetMs: OFFSET_MS } })).ok()).toBe(true);
  const target = before.offsetMs + OFFSET_MS;
  await expect
    .poll(async () => Math.abs((await readPanel(page)).offsetMs - target), { timeout: 20_000 })
    .toBeLessThan(5_000);

  const after = await readPanel(page);
  const sweep = await page.getByTestId('live-sweep-ms').textContent();
  const summary = `before ${JSON.stringify(before.counts)}; after +31 min ${JSON.stringify(after.counts)}; offset ${(after.offsetMs / 1000).toFixed(1)} s; last sweep ${sweep}`;
  test.info().annotations.push({ type: 'F05-T8', description: summary });
  console.log(`[F05-T8] ${summary}`);
  expect(after.total).toBe(VEHICLES);
  expect(after.sum).toBe(VEHICLES);
  expect(after.counts['non-comm']).toBeLessThan(VEHICLES);
});
