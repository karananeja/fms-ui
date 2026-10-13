import { expect, test } from './fixtures.ts';
import { scrollTable, tableTotal } from './table-helpers.ts';

type Win = { __longTasks: number[] };

const longTasks = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const w = globalThis as unknown as Win;
    const out = w.__longTasks;
    w.__longTasks = [];
    return out;
  });

test('F09-T7 budgets: table scroll and CSV export at 1 lakh rows, no long task > 50 ms; export ≤ 5 s', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/live-tracking?view=table');
  await expect.poll(() => tableTotal(page), { timeout: 20_000 }).toBe(100_000);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const w = globalThis as unknown as Win;
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' } as never);
  });

  await scrollTable(page);
  const scroll = await longTasks(page);

  const t0 = Date.now();
  const downloading = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await downloading;
  const exportMs = Date.now() - t0;
  const during = await longTasks(page);

  console.log(
    `F09-T7 perf: scroll long tasks ${JSON.stringify(scroll)}; export ${exportMs} ms, long tasks ${JSON.stringify(during)}`,
  );
  expect(scroll.filter((d) => d > 50)).toEqual([]);
  expect(during.filter((d) => d > 50)).toEqual([]);
  expect(exportMs).toBeLessThanOrEqual(5000);
});
