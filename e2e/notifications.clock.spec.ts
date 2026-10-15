import { loadConfig } from '../mock-server/config.ts';
import { FleetTree } from '../mock-server/generator/fleet-tree.ts';
import { PERSONA, VehicleSim } from '../mock-server/generator/vehicle-sim.ts';
import { NO_GPS_ALERT_MS } from '../mock-server/store/notifications.ts';
import { expect, SIGNED_OUT, test } from './fixtures.ts';
import { shot } from './shots.ts';

const SHOTS = 'docs/features/f15-in-app-notifications/screenshots';
const VIEWER = { email: 'viewer@fms.local', password: 'View@1234' };
const MIN = 60_000;

test.afterEach(async ({ request }) => {
  await request.post('/api/dev/clock', { data: { offsetMs: 0 } });
});

/**
 * F15-T4: the same deterministic sim as the mock (same seed) finds the no-GPS vehicle closest to
 * its 24 h mark outside the Viewer's fleets; moving the clock just past it fires one alert.
 */
test('F15-T4: 24 h no-GPS → critical toast opens the vehicle; out-of-scope Viewer gets nothing', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const config = loadConfig();
  const tree = new FleetTree();
  const sim = new VehicleSim(config.seed, config.vehicles, config.vehicleIntervalMs, tree);

  const viewerCtx = await browser.newContext({ storageState: SIGNED_OUT, baseURL });
  const viewer = await viewerCtx.newPage();
  expect((await viewer.request.post('/api/auth/login', { data: VIEWER })).ok()).toBe(true);
  const viewerFleets = (
    (await (await viewer.request.get('/api/auth/me')).json()) as {
      fleetIds: string[];
    }
  ).fleetIds;

  const now = (
    (await (await request.post('/api/dev/clock', { data: { offsetMs: 0 } })).json()) as {
      now: number;
    }
  ).now;
  let best = -1;
  let left = Infinity;
  for (let i = 0; i < sim.count; i++) {
    if (sim.persona[i] !== PERSONA.noGps || tree.inScope(sim.fleetId(i), viewerFleets)) continue;
    const since = sim.noGpsSince(i, now);
    const rest = since + NO_GPS_ALERT_MS - now;
    if (rest < 2 * MIN || rest >= left) continue;
    if (sim.noGpsSince(i, now + rest + 5 * MIN) !== since) continue;
    best = i;
    left = rest;
  }
  expect(best).toBeGreaterThanOrEqual(0);
  // Sessions last 12 h from the last request, so the jump must stay under that.
  expect(left).toBeLessThan(11 * 60 * MIN);
  const vehicleId = sim.vehicleId(best);
  const regno = sim.regno(best);

  await page.goto('/admin');
  await expect(page.getByTestId('notification-bell')).toBeVisible();
  await viewer.goto('/live-tracking');
  await expect(viewer.getByTestId('notification-bell')).toBeVisible();

  await request.post('/api/dev/clock', { data: { offsetMs: left + MIN } });
  // The predicted vehicle may differ slightly from the mock's live state; any 24 h alert counts.
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'no GPS for 24 hours' })
    .first();
  await expect(toast).toBeVisible({ timeout: 15_000 });
  const title = (await toast.textContent()) ?? '';
  const fired = title.slice(0, title.indexOf(' has had'));
  await shot(page, { path: `${SHOTS}/critical-toast.png` });
  await toast.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/vehicle=/);
  await expect(page.getByTestId('details-regno')).toHaveText(fired, { timeout: 20_000 });

  // The Viewer (Delhi Hub 1 only) is not toasted about out-of-scope vehicles.
  test.info().annotations.push({
    type: 'F15-T4',
    description: `predicted ${regno} (${vehicleId}); fired ${fired}`,
  });
  await expect(viewer.locator('[data-sonner-toast]').filter({ hasText: fired })).toHaveCount(0);
  await viewerCtx.close();
});
