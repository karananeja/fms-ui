import type { APIRequestContext, Page } from '@playwright/test';
import type { ShareLink, ShareOptions } from '@shared/contract/index.ts';
import { expect, metres } from './fixtures.ts';

/** `window.__fmsShareMap` (DEV probe of the public share map, F10b). */
export interface ShareMapProbe {
  center: [number, number];
  zoom: number;
  following: boolean;
  marker: [number, number] | null;
  moving: boolean;
  trailLength: number | null;
  firstMarkerAt: number | null;
  markerUpdates: number;
}

export const shareMap = (page: Page) =>
  page.evaluate(() => {
    const p = (globalThis as unknown as { __fmsShareMap?: ShareMapProbe }).__fmsShareMap;
    return p ? { ...p } : null;
  });

type Trail = { points: [number, number, number][] };

/**
 * A vehicle that is driving right now: reported in the last 30 s and moved > 50 m over its last
 * few reports (so the public page sees position updates within the test). Needs an admin API.
 */
export async function movingVehicle(api: APIRequestContext): Promise<string> {
  const list = (await (await api.get('/api/vehicles?limit=400')).json()) as {
    items: { vehicleId: string }[];
  };
  for (const { vehicleId } of list.items) {
    const res = await api.get(`/api/vehicles/${vehicleId}/trail?minutes=2`);
    if (!res.ok()) continue;
    const { points } = (await res.json()) as Trail;
    if (points.length < 4) continue;
    const last = points.at(-1)!;
    const prev = points.at(-4)!;
    if (Date.now() - last[2] > 30_000) continue;
    if (metres([prev[0], prev[1]], [last[0], last[1]]) > 50) return vehicleId;
  }
  throw new Error('no moving vehicle found in the first 400');
}

export async function createShare(
  api: APIRequestContext,
  vehicleId: string,
  options: ShareOptions,
  ttlMs = 2 * 3600_000,
): Promise<ShareLink> {
  const res = await api.post('/api/share-links', {
    data: { vehicleId, expiresAt: Date.now() + ttlMs, ...options },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as ShareLink;
}

export const LOCATION_ONLY: ShareOptions = {
  show: { drivingEnergy: false, device: false },
  trail: { enabled: false, windowMinutes: 60 },
};
