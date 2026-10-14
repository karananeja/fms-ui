import type { RedactedCombinfo } from '@shared/contract/payloads.ts';
import type { TrailPoint } from './public-share-api';

/** Below this, a position change without `speed` (driving group hidden) is GPS jitter. */
const MOVE_EPS_M = 5;

function metres(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/**
 * Moving or stopped. Uses `speed` when the link shows it; otherwise (location-only links never
 * receive `speed`) compares the last two positions, so no hidden value is needed. `null` =
 * not known yet (first position of a link without speed).
 */
export function isMoving(prev: RedactedCombinfo | null, next: RedactedCombinfo): boolean | null {
  if (typeof next.speed === 'number') return next.speed > 0;
  if (!prev) return null;
  if (prev.gpstime === next.gpstime) return false;
  return metres(prev.longitude, prev.latitude, next.longitude, next.latitude) > MOVE_EPS_M;
}

/**
 * Appends a live point to the trail (skipping anything not newer than the last point) and drops
 * points older than the link's window, measured from the newest point.
 */
export function appendTrail(
  trail: TrailPoint[],
  point: TrailPoint,
  windowMs: number,
): TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last && point[2] <= last[2]) return trail;
  const from = point[2] - windowMs;
  const kept = trail[0] && trail[0][2] < from ? trail.filter((p) => p[2] >= from) : trail;
  return [...kept, point];
}
