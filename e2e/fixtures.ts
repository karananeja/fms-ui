import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, request as apiRequest, type Page } from '@playwright/test';

const blankStyle = readFileSync(new URL('../public/map-styles/blank-dark.json', import.meta.url));
const local = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Signed-in super admin `storageState`, written by `auth.setup.ts` (F02, gitignored). */
export const AUTH_FILE = fileURLToPath(new URL('./.auth/super-admin.json', import.meta.url));
export const SUPER_ADMIN = { email: 'superadmin@fms.local', password: 'Admin@123' };
/** Fresh, signed-out context for specs that sign out or sign in as someone else. */
export const SIGNED_OUT = { cookies: [], origins: [] };

/** Signs in through the API and writes `AUTH_FILE` atomically (parallel workers may race). */
export async function saveSignedInState(baseURL: string): Promise<void> {
  const ctx = await apiRequest.newContext({ baseURL });
  try {
    // `webServer` waits for Vite only; the mock (1 lakh vehicles) may still be starting.
    const deadline = Date.now() + 60_000;
    while (
      !(await ctx.get('/api/health').then(
        (r) => r.ok(),
        () => false,
      ))
    ) {
      if (Date.now() > deadline) throw new Error('mock server not reachable via /api/health');
      await new Promise((r) => setTimeout(r, 500));
    }
    const res = await ctx.post('/api/auth/login', { data: SUPER_ADMIN });
    if (!res.ok()) throw new Error(`super admin sign-in failed: ${res.status()}`);
    mkdirSync(dirname(AUTH_FILE), { recursive: true });
    const tmp = `${AUTH_FILE}.${process.pid}.${Date.now()}.tmp`;
    await ctx.storageState({ path: tmp });
    renameSync(tmp, AUTH_FILE);
  } finally {
    await ctx.dispose();
  }
}

/** True when `AUTH_FILE` exists and its session is still valid on this mock server. */
async function authFileValid(baseURL: string): Promise<boolean> {
  if (!existsSync(AUTH_FILE)) return false;
  const ctx = await apiRequest.newContext({ baseURL, storageState: AUTH_FILE });
  try {
    return (await ctx.get('/api/auth/me')).ok();
  } finally {
    await ctx.dispose();
  }
}

/**
 * Never reach external servers: a reused dev server may point MapLibre at a real style, so any
 * external style request gets the blank offline style and everything else external is aborted.
 */
export const test = base.extend<{ blockExternal: void }, { ensureSignedIn: void }>({
  /**
   * The setup project signs in once (`auth.setup.ts`). When it was skipped (`--no-deps`) or its
   * file is stale (the mock restarted, sessions are memory-only), each worker re-creates it here.
   */
  ensureSignedIn: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs the destructuring form.
    async ({}, use, workerInfo) => {
      const { baseURL, storageState } = workerInfo.project.use;
      if (baseURL && storageState === AUTH_FILE && !(await authFileValid(baseURL))) {
        await saveSignedInState(baseURL);
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  blockExternal: [
    async ({ context }, use) => {
      await context.route(
        (url) => !local.has(url.hostname),
        (route) =>
          /style/i.test(route.request().url())
            ? route.fulfill({ contentType: 'application/json', body: blankStyle })
            : route.abort(),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

export interface FmsMap {
  center: [number, number];
  zoom: number;
  pitch: number;
  bounds: number[];
  frameVersion: number;
  clusterCount: number;
  pointCount: number;
  framed: number;
  autoFitDone: boolean;
  vehicleCount: number;
  moving: boolean;
  selectedVehicleId: string | null;
  trailLength: number | null;
  highlight(): [number, number] | null;
  points(limit?: number): { id: string; lng: number; lat: number; x: number; y: number }[];
}
export type Win = { __fmsMap?: FmsMap };

/** Reads plain fields of `window.__fmsMap` (null until the map controller exists). */
export const mapState = (page: Page) =>
  page.evaluate(() => {
    const m = (globalThis as unknown as Win).__fmsMap;
    return m
      ? {
          center: m.center,
          zoom: m.zoom,
          bounds: m.bounds,
          frameVersion: m.frameVersion,
          clusterCount: m.clusterCount,
          pointCount: m.pointCount,
          framed: m.framed,
          autoFitDone: m.autoFitDone,
          vehicleCount: m.vehicleCount,
          moving: m.moving,
          selectedVehicleId: m.selectedVehicleId,
          trailLength: m.trailLength,
          highlight: m.highlight(),
        }
      : null;
  });

export const mapPoints = (page: Page, limit = 20) =>
  page.evaluate((n) => (globalThis as unknown as Win).__fmsMap?.points(n) ?? [], limit);

/** Waits (bounded) until the camera has stopped and a frame newer than `afterVersion` arrived. */
export async function settled(page: Page, afterVersion = 0, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last: Awaited<ReturnType<typeof mapState>> = null;
  while (Date.now() < end) {
    last = await mapState(page);
    if (last && !last.moving && last.frameVersion > afterVersion) {
      await page.waitForTimeout(300);
      const again = await mapState(page);
      if (again && !again.moving) return again;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`map did not settle within ${timeout} ms: ${JSON.stringify(last)}`);
}

/** Great-circle distance in metres. */
export function metres([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
