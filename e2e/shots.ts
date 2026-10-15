import type { PageScreenshotOptions } from '@playwright/test';

/**
 * UAT screenshots are opt-in: they are written to `docs/features/<id>/screenshots/` only when
 * `FMS_SHOTS=1`, so ordinary e2e runs stay fast and never rewrite the evidence of finished features.
 */
export const SHOTS_ON = process.env.FMS_SHOTS === '1';
export const SHOTS_SKIP_REASON = 'UAT screenshots run only with FMS_SHOTS=1';

type Shootable = { screenshot(options: PageScreenshotOptions): Promise<unknown> };

export async function shot(target: Shootable, options: PageScreenshotOptions & { path: string }) {
  if (SHOTS_ON) await target.screenshot(options);
}
