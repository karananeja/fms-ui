import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** Minimal DOM typing for `evaluate` callbacks (the e2e tsconfig has no DOM lib). */
export type Scroller = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** `ALL · 1,00,000 VEHICLES` → 100000 (null while loading). */
export async function tableTotal(page: Page): Promise<number | null> {
  const m = /·\s*([\d,]+)/.exec((await page.getByTestId('table-count').textContent()) ?? '');
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

/** Wheel-scrolls the table, then jumps deep into it (as dragging the scrollbar would). */
export async function scrollTable(page: Page) {
  const scroller = page.getByTestId('table-scroller');
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(16);
  }
  for (const at of [0.25, 0.5, 0.75, 0.999, 0.1]) {
    await scroller.evaluate((el, f) => {
      const e = el as unknown as Scroller;
      e.scrollTop = (e.scrollHeight - e.clientHeight) * f;
    }, at);
    await page.waitForTimeout(150);
  }
  await expect(scroller.locator('[role=row][data-vehicle-id]').first()).toBeVisible();
}
