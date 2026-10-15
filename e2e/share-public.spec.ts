import type { APIRequestContext, Page, WebSocket } from '@playwright/test';
import { SHARE_GROUP_KEYS } from '@shared/contract/index.ts';
import { adminApi } from './auth-helpers.ts';
import { expect, metres, SIGNED_OUT, test } from './fixtures.ts';
import { createShare, LOCATION_ONLY, movingVehicle, shareMap } from './share-public-helpers.ts';
import { shot as uatShot, SHOTS_ON, SHOTS_SKIP_REASON } from './shots.ts';

const SHOTS = 'docs/features/f10-share-live-location/screenshots';

// The public page is opened in fresh, signed-out contexts; links are created through the API
// (super admin) so these specs don't depend on F10a's UI.
test.use({ storageState: SIGNED_OUT });

let api: APIRequestContext;
let vehicleId: string;

test.beforeAll(async ({ baseURL }) => {
  api = await adminApi(baseURL!);
  vehicleId = await movingVehicle(api);
});
test.afterAll(async () => {
  await api?.dispose();
});

/** Every WS frame the page sends and receives (parsed JSON). */
function recordFrames(page: Page) {
  const sockets: WebSocket[] = [];
  const sent: Record<string, unknown>[] = [];
  const received: Record<string, unknown>[] = [];
  page.on('websocket', (ws) => {
    sockets.push(ws);
    ws.on('framesent', (f) => sent.push(JSON.parse(String(f.payload))));
    ws.on('framereceived', (f) => received.push(JSON.parse(String(f.payload))));
  });
  return { sockets, sent, received };
}

const payloads = (received: Record<string, unknown>[]) =>
  received
    .filter((m) => m.type === 'payload')
    .map((m) => m.data as Record<string, unknown> & { parsedcandata: Record<string, unknown> });

test('F10-T5: live marker, trail, follow / recenter, revoke → unavailable without reload', async ({
  page,
}) => {
  const link = await createShare(api, vehicleId, {
    show: { drivingEnergy: false, device: false },
    trail: { enabled: true, windowMinutes: 60 },
  });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  // Completed trail fetches (dev StrictMode runs effects twice; the first fetch is aborted).
  let trailFetches = 0;
  page.on('requestfinished', (r) => {
    if (new URL(r.url()).pathname.endsWith('/trail')) trailFetches++;
  });
  const frames = recordFrames(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  // Cold load: Vite compiles the modules and headless Chromium starts SwiftShader WebGL (~2 s
  // on its own), so the spec §3 budget is measured on the next, warm navigation.
  await page.goto(link.url);
  await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
  const cold = (await shareMap(page))!.firstMarkerAt!;
  trailFetches = 0;
  await page.reload();
  await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
  const first = (await shareMap(page))!;
  const ms = `cold ${Math.round(cold)} ms, warm ${Math.round(first.firstMarkerAt!)} ms`;
  test.info().annotations.push({ type: 'first-marker', description: ms });
  console.log(`[F10] first marker after navigation: ${ms}`);
  expect(first.firstMarkerAt!, 'first marker within 2 s of navigation').toBeLessThan(2000);
  expect(first.zoom).toBeCloseTo(15, 0);

  // Position updates arrive live and the map follows.
  await expect
    .poll(async () => metres(first.marker!, (await shareMap(page))!.marker!), { timeout: 20_000 })
    .toBeGreaterThan(5);
  await expect
    .poll(async () => (await shareMap(page))!.trailLength, { timeout: 5_000 })
    .toBeGreaterThan(1);
  expect(trailFetches, 'one trail fetch per page load').toBe(1);
  await expect(page.getByTestId('share-live-pill')).toHaveText(/live/i);

  // A user pan stops following and shows Recenter; Recenter follows again.
  const box = (await page.getByTestId('share-map').boundingBox())!;
  const cx = box.x + box.width * 0.7;
  const cy = box.y + box.height * 0.6;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy - 120, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeVisible();
  expect((await shareMap(page))!.following).toBe(false);
  await page.getByRole('button', { name: 'Recenter' }).click();
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeHidden();
  await expect
    .poll(async () => {
      const s = (await shareMap(page))!;
      return s.following && metres(s.center, s.marker!) < 30;
    })
    .toBe(true);

  // Isolation: no app / live-tracking / theme-store modules, no fleet socket (D-090, DS3-T8).
  expect(
    requests.filter((p) =>
      /\/src\/(app|shared\/theme|features\/(live-tracking|access|auth))\//.test(p),
    ),
  ).toEqual([]);
  const live = frames.sockets.map((w) => new URL(w.url())).filter((u) => u.pathname === '/ws/live');
  expect(live.length).toBeGreaterThan(0);
  for (const u of live) expect(u.search).toBe(`?share=${link.token}`);

  // Revoke via the API: the open page switches without a reload.
  expect((await api.delete(`/api/share-links/${link.id}`)).status()).toBe(204);
  await expect(page.getByTestId('share-unavailable')).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole('heading', { name: 'This link is no longer available' }),
  ).toBeVisible();
});

test('F10-T6: enforcement — hidden groups never reach the page', async ({ page }) => {
  const allKeys = [
    ...SHARE_GROUP_KEYS.drivingEnergy.combinfo,
    ...SHARE_GROUP_KEYS.device.combinfo,
  ] as string[];
  const allCan = SHARE_GROUP_KEYS.drivingEnergy.parsedcandata as readonly string[];

  // Location only.
  const loc = await createShare(api, vehicleId, LOCATION_ONLY);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  let frames = recordFrames(page);
  await page.goto(loc.url);
  await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => payloads(frames.received).length, { timeout: 20_000 }).toBeGreaterThan(1);
  for (const data of payloads(frames.received)) {
    for (const k of allKeys) expect(data, k).not.toHaveProperty(k);
    for (const k of allCan) expect(data.parsedcandata, k).not.toHaveProperty(k);
  }
  expect(frames.sent.filter((m) => m.topic === 'lafparsed')).toEqual([]);
  expect(frames.sent.filter((m) => m.type === 'subscribe')).toHaveLength(1);
  expect(requests.filter((p) => p.endsWith('/trail'))).toEqual([]);
  await expect(page.getByTestId('share-group-location')).toBeVisible();
  await expect(page.getByTestId('share-group-driving')).toHaveCount(0);
  await expect(page.getByTestId('share-group-device')).toHaveCount(0);
  const text = await page.getByTestId('share-page').innerText();
  for (const label of ['Speed', 'SOC', 'Range', 'Odometer', 'Signal', 'battery'])
    expect(text).not.toContain(label);

  // Driving only: speed / SOC shown, device keys still absent.
  const drive = await createShare(api, vehicleId, {
    show: { drivingEnergy: true, device: false },
    trail: { enabled: false, windowMinutes: 60 },
  });
  await page.close();
  const page2 = await page.context().newPage();
  frames = recordFrames(page2);
  await page2.goto(drive.url);
  await expect(page2.getByTestId('share-metric-speed')).toHaveText(/km\/h/, { timeout: 10_000 });
  await expect(page2.getByTestId('share-metric-soc')).toHaveText(/%/);
  await expect(page2.getByTestId('share-group-device')).toHaveCount(0);
  await expect.poll(() => payloads(frames.received).length, { timeout: 20_000 }).toBeGreaterThan(1);
  for (const data of payloads(frames.received)) {
    expect(data).toHaveProperty('speed');
    for (const k of SHARE_GROUP_KEYS.device.combinfo) expect(data, k).not.toHaveProperty(k);
  }
  expect(frames.sent.filter((m) => m.topic === 'lafparsed')).toEqual([]);
});

test('F10-T8: public page UAT screenshots', async ({ page }) => {
  test.skip(!SHOTS_ON, SHOTS_SKIP_REASON);
  const all = await createShare(api, vehicleId, {
    show: { drivingEnergy: true, device: true },
    trail: { enabled: true, windowMinutes: 60 },
  });
  const loc = await createShare(api, vehicleId, LOCATION_ONLY);
  const shot = async (name: string) => {
    // Let the marker settle after the follow animation.
    await page.waitForTimeout(400);
    await uatShot(page, { path: `${SHOTS}/public-${name}.png` });
  };
  const open = async (url: string) => {
    await page.goto(url);
    await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('share-live-pill')).toHaveText(/live/i);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(all.url);
  await expect.poll(async () => (await shareMap(page))!.trailLength ?? 0).toBeGreaterThan(1);
  await shot('desktop-all-data');
  await open(loc.url);
  await shot('desktop-location-only');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(all.url);
  await shot('mobile-all-data');
  await page.getByTestId('share-card-toggle').click();
  await shot('mobile-collapsed');
  await open(loc.url);
  await shot('mobile-location-only');

  expect((await api.delete(`/api/share-links/${loc.id}`)).status()).toBe(204);
  await page.goto(loc.url);
  await expect(
    page.getByRole('heading', { name: 'This link is no longer available' }),
  ).toBeVisible();
  await shot('mobile-unavailable');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot('desktop-unavailable');
  await page.goto('/share/no-such-token');
  await expect(page.getByRole('heading', { name: 'Link not found' })).toBeVisible();
  await shot('desktop-not-found');
});
