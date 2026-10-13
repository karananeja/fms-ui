import { expect, mapState, settled, test } from './fixtures.ts';

type PerfWin = { __longTasks: number[] };

/**
 * F08 §3 budgets at 1 lakh vehicles: next map frame ≤ 200 ms after a filter change, and no
 * main-thread long task > 50 ms while typing or filtering. Times are reported.
 */
test('F08 budgets: frame after filter change, long tasks while typing/filtering', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as PerfWin;
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/live-tracking');
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  await settled(page);
  await page.waitForTimeout(1500); // let the post-snapshot work (index builds) finish
  await page.evaluate(() => ((globalThis as unknown as PerfWin).__longTasks = []));

  /** ms from `act` until the map shows a newer frame. */
  const frameAfter = async (act: () => Promise<void>) => {
    const v0 = (await mapState(page))!.frameVersion;
    const t0 = Date.now();
    await act();
    await expect
      .poll(async () => (await mapState(page))!.frameVersion, { intervals: [10], timeout: 5000 })
      .toBeGreaterThan(v0);
    return Date.now() - t0;
  };

  const frames: Record<string, number> = {};
  frames.running = await frameAfter(() =>
    page.getByRole('button', { name: /^Running: / }).click(),
  );
  frames.stopped = await frameAfter(() =>
    page.getByRole('button', { name: /^Stopped: / }).click(),
  );
  frames.all = await frameAfter(() => page.getByRole('button', { name: /^All: / }).click());

  const box = page.getByRole('combobox', { name: 'Search vehicles' });
  await box.pressSequentially('KA01AB', { delay: 60 });
  await expect(page.getByRole('option').first()).toBeVisible();
  frames.search = await frameAfter(() => box.press('Enter'));
  frames.clear = await frameAfter(() => page.getByRole('button', { name: 'Clear all' }).click());

  const longTasks = await page.evaluate(() => (globalThis as unknown as PerfWin).__longTasks);
  console.log(
    `[F08 budgets] frame after filter change (ms): ${Object.entries(frames)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}; long tasks while typing/filtering: ${
      longTasks.length ? longTasks.map((d) => d.toFixed(0)).join('/') + ' ms' : 'none'
    }`,
  );
  for (const [k, v] of Object.entries(frames)) expect(v, k).toBeLessThanOrEqual(200);
  expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(50);
});
