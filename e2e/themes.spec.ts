import { request as apiRequest, type Page } from '@playwright/test';
import { adminApi } from './auth-helpers.ts';
import { expect, mapState, metres, settled, SIGNED_OUT, test, type Win } from './fixtures.ts';
import { createShare, LOCATION_ONLY, movingVehicle } from './share-public-helpers.ts';

/** The DOM bits used in `evaluate` (the e2e tsconfig has no DOM lib). */
interface Dom {
  getComputedStyle(el: unknown): { fontFamily: string; backgroundColor: string };
  document: { documentElement: { dataset: Record<string, string | undefined> } };
}

const SHOTS = 'docs/features/ds3-themes-fonts/screenshots';
const LIGHT_STYLE = /blank-light\.json/;
const DARK_STYLE = /blank-dark\.json/;

const htmlTheme = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Dom).document.documentElement.dataset.theme);

const fontOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).fontFamily);

/** Stored preference applied before any page script (as if chosen earlier). */
const preferTheme = (page: Page, theme: 'light' | 'dark' | 'system') =>
  page.addInitScript((t) => {
    try {
      (
        globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }
      ).localStorage.setItem('fms.theme', t);
    } catch {
      // ignore
    }
  }, theme);

const probe = (page: Page) =>
  page.evaluate(() => {
    const m = (globalThis as unknown as Win).__fmsMap;
    return m
      ? {
          styleUrl: m.styleUrl,
          viewportsSent: m.viewportsSent,
          ring: m.hasLayer('selected-ring'),
          buildings: m.hasLayer('fms-buildings'),
          rendered: m.renderedVehicles(),
        }
      : null;
  });

async function openFitted(page: Page, path = '/live-tracking') {
  await page.goto(path);
  await expect
    .poll(async () => (await mapState(page))?.autoFitDone, { timeout: 15_000 })
    .toBe(true);
  return settled(page);
}

test.describe('DS3-T4: toggle, persistence and System', () => {
  test('Light persists across reload and new pages; body uses the light --bg', async ({
    page,
    context,
  }) => {
    await page.goto('/admin');
    expect(await htmlTheme(page)).toBe('dark');
    const group = page.getByRole('radiogroup', { name: 'Theme' }).first();
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await group.getByRole('radio', { name: 'Light' }).click();
    expect(await htmlTheme(page)).toBe('light');
    await page.reload();
    expect(await htmlTheme(page)).toBe('light');
    const bg = await page
      .locator('body')
      .evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(244, 246, 249)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');

    const other = await context.newPage();
    await other.goto('/admin/fleets');
    expect(await htmlTheme(other)).toBe('light');
    await other.close();
  });

  test('System follows the OS live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/admin');
    expect(await htmlTheme(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => htmlTheme(page)).toBe('light');
  });

  test('user menu also switches the theme; phones get the cycle button', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: /^Account:/ }).click();
    const menu = page.getByRole('dialog', { name: 'Account' });
    await menu.getByRole('radio', { name: 'Light' }).click();
    expect(await htmlTheme(page)).toBe('light');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    const cycle = page.getByTestId('theme-cycle');
    await expect(cycle).toBeVisible();
    await expect(page.getByTestId('theme-toggle')).toBeHidden();
    await cycle.click();
    expect(await htmlTheme(page)).toBe('dark');
    await expect(cycle).toHaveAccessibleName(/^Theme: Dark/);
  });
});

test.describe('DS3-T5: no flash', () => {
  for (const [stored, os] of [
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const) {
    test(`stored ${stored} under a ${os} OS: the HTML alone sets data-theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await preferTheme(page, stored);
      // No app code at all: only index.html's inline script can set the theme.
      await page.route(/\/src\//, (route) => route.abort());
      await page.goto('/login');
      expect(await htmlTheme(page)).toBe(stored);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        stored === 'light' ? '#ffffff' : '#0a0d11',
      );
    });
  }
});

test.describe('DS3-T6: map swap keeps camera, selection and markers', () => {
  test.describe.configure({ mode: 'serial' });

  async function selectAtZoom15(page: Page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFitted(page, '/live-tracking?debug=1');
    const list = (await (await page.request.get('/api/vehicles?limit=1')).json()) as {
      items: { vehicleId: string }[];
    };
    await page.getByLabel('Locate vehicle ID').fill(list.items[0]!.vehicleId);
    await page.getByRole('button', { name: 'Locate' }).click();
    await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
    await expect.poll(async () => (await mapState(page))?.highlight).not.toBeNull();
    await expect
      .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
      .toBeCloseTo(16, 1);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect
      .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
      .toBeCloseTo(15, 1);
    await settled(page);
    // Pan a little (the selection stays).
    const box = (await page.getByTestId('live-map').boundingBox())!;
    const [x, y] = [box.x + box.width * 0.4, box.y + box.height * 0.6];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 80, y - 40, { steps: 5 });
    await page.mouse.up();
    await settled(page);
    await page.waitForTimeout(400);
  }

  async function swapTo(page: Page, theme: 'Light' | 'Dark', style: RegExp) {
    const before = (await mapState(page))!;
    const sent = (await probe(page))!.viewportsSent;
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: theme })
      .click();
    await expect.poll(async () => (await probe(page))?.styleUrl).toMatch(style);
    await expect
      .poll(async () => (await probe(page))?.rendered, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(500); // > viewport debounce
    const after = (await mapState(page))!;
    const p = (await probe(page))!;
    expect(Math.abs(after.center[0] - before.center[0])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(after.center[1] - before.center[1])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(after.zoom - before.zoom)).toBeLessThanOrEqual(1e-6);
    // The selection survives; its marker may have moved with live data during the swap.
    expect(after.highlight).not.toBeNull();
    expect(metres(after.highlight!, before.highlight!)).toBeLessThan(500);
    expect(after.selectedVehicleId).toBe(before.selectedVehicleId);
    expect(p.ring).toBe(true);
    expect(p.viewportsSent, 'no viewport sent to the worker').toBe(sent);
    await expect(page.locator('[data-details-panel]').first()).toBeVisible();
    return p;
  }

  test('2D: dark → light → dark', async ({ page }) => {
    await selectAtZoom15(page);
    expect((await probe(page))!.styleUrl).toMatch(DARK_STYLE);
    await swapTo(page, 'Light', LIGHT_STYLE);
    await swapTo(page, 'Dark', DARK_STYLE);
    // DS3-R14: the dev debug overlay counts the swaps.
    await page.getByRole('button', { name: 'Expand diagnostics' }).click();
    await expect(page.getByTestId('live-theme-swaps')).toHaveText('2');
  });

  test('3D: buildings come back after the swap', async ({ page }) => {
    // The blank test styles have no building data: add an empty `building` source-layer.
    const withBuildings = (bg: string) =>
      JSON.stringify({
        version: 8,
        sources: { b: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': bg } },
          { id: 'building', type: 'fill', source: 'b', 'source-layer': 'building' },
        ],
      });
    await page.route(/\/map-styles\/blank-(dark|light)\.json$/, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: withBuildings(/light/.test(route.request().url()) ? 'white' : 'black'),
      }),
    );
    await selectAtZoom15(page);
    await page.getByRole('button', { name: '3D view' }).click();
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as Win).__fmsMap?.pitch ?? -1))
      .toBeCloseTo(55, 0);
    await settled(page);
    await page.waitForTimeout(400);
    expect((await probe(page))!.buildings).toBe(true);
    expect((await swapTo(page, 'Light', LIGHT_STYLE)).buildings).toBe(true);
    expect((await swapTo(page, 'Dark', DARK_STYLE)).buildings).toBe(true);
    await page.getByRole('button', { name: '3D view' }).click();
  });
});

test('DS3-T7: Inter for text, Doto for display', async ({ page }) => {
  await page.goto('/live-tracking');
  await expect(page.locator('button[aria-pressed] b').first()).toBeVisible({ timeout: 15_000 });
  for (const sel of ['body', 'button', 'input']) {
    expect(await fontOf(page, sel), sel).toMatch(/^"?Inter/);
  }
  for (const sel of [
    '[role="img"][aria-label="FMS"]',
    '[data-testid="page-title"]',
    'button[aria-pressed] b',
  ]) {
    expect(await fontOf(page, sel), sel).toMatch(/^"?Doto/);
  }
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('cell').first()).toBeVisible({ timeout: 10_000 });
  expect(await fontOf(page, '[role="cell"]')).toMatch(/^"?Inter/);

  await page.goto('/analytics');
  await expect(page.getByTestId('tile-value').first()).toBeVisible({ timeout: 20_000 });
  expect(await fontOf(page, '[data-testid="tile-value"]')).toMatch(/^"?Doto/);

  await page.getByTestId('ask-fms').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible({ timeout: 10_000 });
  const chat = page.getByTestId('assistant-panel');
  expect(
    await chat.evaluate((el) => (globalThis as unknown as Dom).getComputedStyle(el).fontFamily),
  ).toMatch(/^"?Inter/);
});

test.describe('DS3-T8: share page keeps share-light and the new fonts', () => {
  test.use({ storageState: SIGNED_OUT });
  for (const theme of ['light', 'dark'] as const) {
    test(`app theme ${theme}`, async ({ page, baseURL }) => {
      const api = await adminApi(baseURL!);
      const link = await createShare(api, await movingVehicle(api), LOCATION_ONLY);
      await preferTheme(page, theme);
      await page.goto(link.url);
      await expect(page.getByTestId('share-marker')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-theme="share-light"]').first()).toBeVisible();
      expect(await fontOf(page, 'body')).toMatch(/^"?Inter/);
      // Regnos are data, not titles: Inter (spec §10.4).
      expect(await fontOf(page, '[data-testid="share-regno"]')).toMatch(/^"?Inter/);
      expect(await htmlTheme(page)).toBe(theme);
      await api.dispose();
    });
  }
});

/**
 * DS3-T9: UAT screenshots in both themes (desktop 1440; 390 px for the starred ones). Runs only
 * with `FMS_E2E_FONTS=1` so Inter renders; each shot is soft (one failing step keeps the rest).
 */
test.describe('DS3-T9: screenshots', () => {
  test.skip(process.env.FMS_E2E_FONTS !== '1', 'screenshots need FMS_E2E_FONTS=1');
  test.describe.configure({ mode: 'serial' });

  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} theme`, async ({ page, browser, baseURL }) => {
      test.setTimeout(300_000);
      const failed: string[] = [];
      const shot = async (name: string, steps: () => Promise<void>, fullPage = false) => {
        try {
          await steps();
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${SHOTS}/${theme}-${name}.png`, fullPage });
        } catch (e) {
          failed.push(`${name}: ${String(e).split('\n')[0]}`);
        }
      };
      await preferTheme(page, theme);
      const desktop = () => page.setViewportSize({ width: 1440, height: 900 });
      const phone = () => page.setViewportSize({ width: 390, height: 844 });
      await desktop();

      await shot('live-clusters', async () => {
        await openFitted(page);
        await expect(page.getByTestId('map-cluster').first()).toBeVisible({ timeout: 10_000 });
      });
      await shot('live-clusters-390', async () => {
        await phone();
        await openFitted(page);
        await expect(page.getByTestId('map-cluster').first()).toBeVisible({ timeout: 10_000 });
      });
      await desktop();
      await shot('live-zoom15-details', async () => {
        await openFitted(page, '/live-tracking?debug=1');
        const list = (await (await page.request.get('/api/vehicles?limit=1')).json()) as {
          items: { vehicleId: string }[];
        };
        await page.getByLabel('Locate vehicle ID').fill(list.items[0]!.vehicleId);
        await page.getByRole('button', { name: 'Locate' }).click();
        await page.getByRole('button', { name: 'Collapse diagnostics' }).click();
        await expect
          .poll(async () => (await mapState(page))?.zoom, { timeout: 10_000 })
          .toBeCloseTo(16, 1);
        await page.getByRole('button', { name: 'Zoom out' }).click();
        await settled(page);
        await expect(page.locator('[data-details-panel]').first()).toBeVisible();
      });
      await shot('filter-panel', async () => {
        await openFitted(page);
        await page.getByRole('button', { name: 'Filters' }).click();
      });
      await shot('table-view', async () => {
        await openFitted(page);
        await page.getByRole('button', { name: 'Table view' }).click();
        await expect(page.getByRole('cell').first()).toBeVisible({ timeout: 10_000 });
      });
      await shot('notifications', async () => {
        await page.goto('/admin');
        await page.getByTestId('notification-bell').click();
        await page.waitForTimeout(600);
      });
      await shot('assistant', async () => {
        await page.goto('/admin');
        await page.getByTestId('ask-fms').click();
        await expect(page.getByTestId('assistant-panel')).toBeVisible({ timeout: 10_000 });
      });
      for (const [name, path] of [
        ['admin-overview', '/admin'],
        ['fleets', '/admin/fleets'],
        ['users', '/admin/users'],
        ['roles', '/admin/roles'],
        ['invites', '/admin/invites'],
        ['share-links', '/admin/share-links'],
        ['drivers', '/admin/drivers'],
      ] as const) {
        await shot(name, async () => {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
          await page.waitForLoadState('networkidle').catch(() => {});
        });
      }
      await shot('dialog-scrim', async () => {
        await page.goto('/admin/invites');
        await page.getByRole('button', { name: 'Invite user' }).click();
        await expect(page.getByRole('dialog', { name: 'Invite user' })).toBeVisible();
      });
      await shot('toast', async () => {
        const dialog = page.getByRole('dialog', { name: 'Invite user' });
        await dialog.getByLabel('Email').fill(`ds3-${theme}-${Date.now()}@fms.local`);
        await dialog.getByLabel('Role').selectOption({ index: 1 });
        await dialog.getByLabel('Fleet scope').getByText('North', { exact: true }).click();
        await dialog.getByRole('button', { name: 'Send invite' }).click();
        await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 5_000 });
      });
      await shot('requests', async () => {
        // The seed driver reports a breakdown (once; a second report is refused) so the desk
        // and the driver page have something to show.
        const driver = await apiRequest.newContext({ baseURL });
        await driver.post('/api/auth/login', {
          data: { email: 'driver@fms.local', password: 'Drive@1234' },
        });
        await driver.post('/api/requests', {
          data: { type: 'breakdown', reason: 'tyre', note: 'Flat tyre (DS3 screenshot)' },
        });
        await driver.dispose();
        await page.goto('/requests');
        await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
        await page.waitForTimeout(800);
      });
      await shot('requests-drawer', async () => {
        await page.locator('[role="row"][data-row-key]').first().click({ timeout: 5_000 });
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(1500);
      });
      await shot(
        'analytics-vehicles',
        async () => {
          await page.goto('/analytics');
          await expect(page.getByTestId('kpi-tiles')).toBeVisible({ timeout: 20_000 });
        },
        true,
      );
      await shot('analytics-drilldown', async () => {
        await page.getByTestId('ranking-row').first().click();
        await expect(page.getByTestId('drilldown')).toBeVisible({ timeout: 15_000 });
      });

      // Signed out: login and the public share page; then the seed driver's page.
      const ctx = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        reducedMotion: 'no-preference',
        colorScheme: 'dark',
      });
      const out = await ctx.newPage();
      await out.addInitScript((t) => {
        (globalThis as unknown as { localStorage: Storage }).localStorage.setItem('fms.theme', t);
      }, theme);
      const outShot = async (name: string, w: number, h: number, go: () => Promise<void>) => {
        try {
          await out.setViewportSize({ width: w, height: h });
          await go();
          await out.waitForTimeout(800);
          await out.screenshot({ path: `${SHOTS}/${theme}-${name}.png` });
        } catch (e) {
          failed.push(`${name}: ${String(e).split('\n')[0]}`);
        }
      };
      await outShot('login', 1440, 900, async () => {
        await out.goto('/login');
        await expect(out.getByLabel('Email')).toBeVisible();
      });
      await outShot('login-390', 390, 844, async () => {
        await out.goto('/login');
        await expect(out.getByLabel('Email')).toBeVisible();
      });
      await outShot('share-page', 1440, 900, async () => {
        const api = await adminApi(baseURL!);
        const link = await createShare(api, await movingVehicle(api), LOCATION_ONLY);
        await api.dispose();
        await out.goto(link.url);
        await expect(out.getByTestId('share-marker')).toBeVisible({ timeout: 15_000 });
      });
      const login = await out.request.post('/api/auth/login', {
        data: { email: 'driver@fms.local', password: 'Drive@1234' },
      });
      if (login.ok()) {
        for (const [name, w, h] of [
          ['driver-page', 1440, 900],
          ['driver-page-390', 390, 844],
        ] as const) {
          await outShot(name, w, h, async () => {
            await out.goto('/driver');
            await expect(out.getByTestId('driver-greeting')).not.toHaveText('…', {
              timeout: 10_000,
            });
          });
        }
      } else failed.push(`driver sign-in: ${login.status()}`);
      await ctx.close();

      test.info().annotations.push({ type: 'skipped shots', description: failed.join(' | ') });
      console.log(`[DS3-T9 ${theme}] failed shots: ${failed.length ? failed.join(' | ') : 'none'}`);
    });
  }
});
