import { vehicleListSchema } from '@shared/contract/index.ts';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

interface FmsLive {
  pushCount: number;
  firstDataAt: number;
  snapshotCompleteAt: number;
}
type Win = { __fmsLive?: FmsLive; __longTasks: { start: number; duration: number }[] };

const VEHICLES = 100_000;
const OBSERVE_MS = 15_000;

test.describe.configure({ mode: 'serial' });

const metrics = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Win).__fmsLive ?? null);

/**
 * Opens /live-tracking (already signed in by the F02 setup project, so the session check is one
 * `GET /api/auth/me` where the dev auto sign-in used to be) and waits until the snapshot is in.
 */
async function openLive(page: Page) {
  const me = page.waitForResponse((r) => r.url().endsWith('/api/auth/me'), { timeout: 10_000 });
  await page.goto('/live-tracking?debug=1');
  expect((await me).status()).toBe(200);
  await expect(page.getByTestId('live-connection')).toHaveText('Live', { timeout: 10_000 });
  await expect
    .poll(async () => (await metrics(page))?.snapshotCompleteAt ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  return (await metrics(page))!;
}

test('F04-T9: signed in, Live with 1 lakh vehicles within budget, selection shows regno', async ({
  page,
}) => {
  const m = await openLive(page);
  await expect(page.getByTestId('live-vehicle-count')).toHaveText(
    new Intl.NumberFormat('en-IN').format(VEHICLES),
  );
  test.info().annotations.push({
    type: 'F04-T9',
    description: `firstDataAt ${Math.round(m.firstDataAt)} ms, snapshotCompleteAt ${Math.round(m.snapshotCompleteAt)} ms, state ${await page.getByTestId('live-state-size').textContent()}`,
  });
  console.log(
    `[F04-T9] firstDataAt=${m.firstDataAt.toFixed(0)}ms snapshotCompleteAt=${m.snapshotCompleteAt.toFixed(0)}ms state=${await page.getByTestId('live-state-size').textContent()}`,
  );
  expect(m.firstDataAt).toBeLessThanOrEqual(2000);
  expect(m.snapshotCompleteAt).toBeLessThanOrEqual(5000);

  const list = vehicleListSchema.parse(
    await (await page.request.get('/api/vehicles?limit=1')).json(),
  );
  const vehicle = list.items[0]!;
  await page.getByLabel('Select vehicle').fill(vehicle.vehicleId);
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.getByTestId('live-selected')).toContainText(vehicle.regno);
  await expect(page.getByTestId('live-selected')).toContainText('374');
});

test('F04-T10: no main-thread long task > 50 ms and ≤ 4 pushes/s while streaming', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as Win;
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        w.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true } as never);
  });
  await openLive(page);
  const start = await page.evaluate(() => ({
    t: performance.now(),
    pushes: (globalThis as unknown as Win).__fmsLive!.pushCount,
  }));
  await page.waitForTimeout(OBSERVE_MS);
  const end = await page.evaluate(() => ({
    t: performance.now(),
    pushes: (globalThis as unknown as Win).__fmsLive!.pushCount,
    longTasks: (globalThis as unknown as Win).__longTasks,
  }));
  const seconds = (end.t - start.t) / 1000;
  const pushRate = (end.pushes - start.pushes) / seconds;
  const during = end.longTasks.filter((l) => l.start >= start.t);
  const loadMax = Math.max(
    0,
    ...end.longTasks.filter((l) => l.start < start.t).map((l) => l.duration),
  );
  const summary = `window ${seconds.toFixed(1)} s, pushes ${end.pushes - start.pushes} (${pushRate.toFixed(2)}/s), long tasks during stream ${during.length} (max ${Math.max(0, ...during.map((l) => l.duration)).toFixed(0)} ms), longest during page load ${loadMax.toFixed(0)} ms, rows/s ${await page
    .getByText(/^Rows \/ s$/)
    .locator('..')
    .locator('dd')
    .textContent()}`;
  test.info().annotations.push({ type: 'F04-T10', description: summary });
  console.log(`[F04-T10] ${summary}`);
  expect(during).toEqual([]);
  expect(pushRate).toBeLessThanOrEqual(4);
  expect(end.pushes - start.pushes).toBeLessThanOrEqual(Math.ceil(seconds) * 4);
  expect(end.pushes).toBeGreaterThan(start.pushes);

  // Sanity: the observer records a deliberate 120 ms page task (CDP-evaluated code is not a task).
  await page.evaluate(() => {
    setTimeout(() => {
      const until = performance.now() + 120;
      while (performance.now() < until);
    }, 0);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as unknown as Win).__longTasks.some((l) => l.duration >= 100),
      ),
    )
    .toBe(true);
});
