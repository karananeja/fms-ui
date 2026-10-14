import { expect, test } from './fixtures.ts';

type PerfWin = { __longTasks: { start: number; duration: number }[] };

/**
 * F03 §3 budgets: the full seeded tree renders and expands with no main-thread long task
 * > 50 ms; vehicle list pages (cursor pages of 100) load in ≤ 300 ms from the mock.
 */
test('F03 budgets: tree render/expand long tasks, vehicle page load time', async ({ page }) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as PerfWin;
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        w.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ entryTypes: ['longtask' as never] });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageTimes: number[] = [];
  const pageUrls: string[] = [];
  page.on('requestfinished', (req) => {
    if (!/\/api\/vehicles\?.*fleetId=/.test(req.url())) return;
    const t = req.timing();
    pageTimes.push(Math.round(t.responseEnd - t.requestStart));
    pageUrls.push(req.url().replace(/^.*\?/, ''));
  });

  await page.goto('/admin/fleets');
  const tree = page.getByRole('tree', { name: 'Fleet tree' });
  await expect(tree.getByRole('treeitem', { name: 'Acme Mobility' })).toBeVisible();
  // Long tasks from here on: first tree render is done; page boot (bundle eval) is excluded.
  const t0 = await page.evaluate(() => performance.now());

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(tree.getByRole('treeitem', { name: 'Delhi Hub 1 · Team A' })).toBeVisible();
  for (const f of [0.25, 0.5, 0.75, 1, 0]) {
    await tree.evaluate((el, at) => {
      const e = el as unknown as { scrollTop: number; scrollHeight: number; clientHeight: number };
      e.scrollTop = (e.scrollHeight - e.clientHeight) * at;
    }, f);
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await page.getByRole('searchbox', { name: 'Search fleets' }).fill('Team');
  await page.getByRole('searchbox', { name: 'Search fleets' }).fill('');
  await page.waitForTimeout(300);
  const all = await page.evaluate(() => (globalThis as unknown as PerfWin).__longTasks);
  const longTasks = all.filter((l) => l.start >= t0);
  const boot = all.filter((l) => l.start < t0);

  // Vehicle pages: a city with ~800 direct vehicles, scrolled to load several pages.
  await page.getByRole('searchbox', { name: 'Search fleets' }).fill('Delhi');
  await tree.getByRole('treeitem', { name: 'Delhi', exact: true }).click();
  const scroller = page.getByTestId('vehicle-scroller');
  await expect(scroller.locator('[role=row][data-vehicle-id]').first()).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await scroller.evaluate((el) => {
      const e = el as unknown as { scrollTop: number; scrollHeight: number };
      e.scrollTop = e.scrollHeight;
    });
    await expect(page.getByTestId('vehicle-list-status')).toContainText(`${(i + 2) * 100} loaded`);
  }

  console.log(
    `[F03 budgets] long tasks (tree render/expand/scroll/search, ms): ${
      longTasks.map((l) => Math.round(l.duration)).join(', ') || 'none'
    }; before (page boot + first tree render, dev build): ${
      boot.map((l) => Math.round(l.duration)).join(', ') || 'none'
    }; vehicle page loads (ms): ${pageTimes.map((t, i) => `${t} [${pageUrls[i]}]`).join(', ')}`,
  );
  expect(longTasks.filter((l) => l.duration > 50)).toEqual([]);
  expect(pageTimes.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...pageTimes)).toBeLessThanOrEqual(300);
});
