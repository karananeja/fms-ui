import type { Page } from '@playwright/test';
import { expect, mapState, settled, test } from './fixtures.ts';

const VEHICLES = 100_000;
const SCRIPT_MS = 10_000;
type Win = {
  __longTasks: { start: number; duration: number }[];
  __frames: number[];
  __sampling: boolean;
  requestAnimationFrame(cb: (t: number) => void): number;
};

async function wheel(page: Page, times: number, dy: number) {
  for (let k = 0; k < times; k++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(60);
  }
}

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 20 });
  await page.mouse.up();
}

test('F06-T9: 10 s of scripted pans/zooms at 1 lakh vehicles, no long task > 50 ms', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as Win;
    w.__longTasks = [];
    w.__frames = [];
    w.__sampling = false;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        w.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true } as never);
    const tick = (t: number) => {
      if (w.__sampling) w.__frames.push(t);
      w.requestAnimationFrame(tick);
    };
    w.requestAnimationFrame(tick);
  });
  await page.goto('/live-tracking');
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  const fitted = await settled(page);
  expect(fitted.vehicleCount).toBe(VEHICLES);
  // Start over a dense city (Mumbai + Thane, ~5 000 vehicles) so frames carry real load.
  await page.getByRole('button', { name: 'Jump to city…' }).click();
  await page
    .getByRole('option', { name: /Mumbai/ })
    .getByRole('button')
    .click();
  await expect
    .poll(async () => (await mapState(page))!.zoom, { timeout: 10_000 })
    .toBeGreaterThan(fitted.zoom + 3);
  const start = await settled(page);

  const box = (await page.getByTestId('live-map').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const t0 = await page.evaluate(() => {
    (globalThis as unknown as Win).__sampling = true;
    return performance.now();
  });
  const end = Date.now() + SCRIPT_MS;
  const steps: (() => Promise<void>)[] = [
    () => drag(page, cx, cy, -220, 90),
    async () => {
      await page.mouse.move(cx, cy);
      await wheel(page, 7, -240);
    },
    () => drag(page, cx, cy, 260, -140),
    () => drag(page, cx, cy, -120, -200),
    async () => {
      await page.mouse.move(cx + 80, cy + 40);
      await wheel(page, 7, -240);
    },
    () => drag(page, cx, cy, 300, 160),
    async () => {
      await page.mouse.move(cx, cy);
      await wheel(page, 14, 240);
    },
    () => drag(page, cx, cy, 200, 200),
  ];
  let ops = 0;
  let maxZoom = 0;
  let maxPoints = 0;
  let maxClusters = 0;
  while (Date.now() < end) {
    await steps[ops++ % steps.length]!();
    await page.waitForTimeout(120);
    const m = (await mapState(page))!;
    maxZoom = Math.max(maxZoom, m.zoom);
    maxPoints = Math.max(maxPoints, m.pointCount);
    maxClusters = Math.max(maxClusters, m.clusterCount);
  }
  const res = await page.evaluate((from) => {
    const w = globalThis as unknown as Win;
    w.__sampling = false;
    const f = w.__frames;
    const dt = f.slice(1).map((t, k) => t - f[k]!);
    return {
      longTasks: w.__longTasks.filter((l) => l.start >= from),
      dt,
      ms: performance.now() - from,
    };
  }, t0);
  const final = (await mapState(page))!;

  const sorted = [...res.dt].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const mean = res.dt.reduce((a, b) => a + b, 0) / Math.max(1, res.dt.length);
  const summary = `window ${(res.ms / 1000).toFixed(1)} s, ${ops} gestures, long tasks ${res.longTasks.length} (max ${Math.max(0, ...res.longTasks.map((l) => l.duration)).toFixed(0)} ms); rAF frames ${res.dt.length}, mean ${mean.toFixed(1)} ms (${(1000 / mean).toFixed(0)} fps), p50 ${pct(0.5).toFixed(1)} ms, p95 ${pct(0.95).toFixed(1)} ms, max ${(sorted.at(-1) ?? 0).toFixed(1)} ms; frames received ${final.frameVersion - start.frameVersion}, zoom ${start.zoom.toFixed(1)} (Mumbai) → max ${maxZoom.toFixed(1)}, max ${maxPoints} points / ${maxClusters} clusters per frame`;
  test.info().annotations.push({ type: 'F06-T9', description: summary });
  console.log(`[F06-T9] ${summary}`);
  expect(ops).toBeGreaterThanOrEqual(7);
  expect(final.frameVersion).toBeGreaterThan(start.frameVersion);
  expect(res.longTasks).toEqual([]);
});
