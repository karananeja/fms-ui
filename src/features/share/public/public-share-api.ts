import type { PublicShare } from '@shared/contract/share-links.ts';
import { ApiError, apiFetch } from '@/shared/api/api-client';

/** `[lng, lat, ts]` */
export type TrailPoint = [number, number, number];

export type PublicShareResult =
  { kind: 'ok'; share: PublicShare } | { kind: 'gone' } | { kind: 'not-found' };

const path = (token: string) => `/api/public/share/${encodeURIComponent(token)}`;

/**
 * F10-R8: `GET /api/public/share/:token`. 200 → the share; 410 → expired or revoked; 404 →
 * unknown token. Anything else (network, 5xx) throws an `ApiError`.
 */
export async function getPublicShare(
  token: string,
  signal?: AbortSignal,
): Promise<PublicShareResult> {
  try {
    return { kind: 'ok', share: await apiFetch<PublicShare>(path(token), { signal }) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) return { kind: 'gone' };
    if (e instanceof ApiError && e.status === 404) return { kind: 'not-found' };
    throw e;
  }
}

/** F10-R10: the trail window, fetched once and only for links with the trail enabled. */
export async function getPublicTrail(token: string, signal?: AbortSignal): Promise<TrailPoint[]> {
  const res = await apiFetch<{ points: TrailPoint[] }>(`${path(token)}/trail`, { signal });
  return res.points;
}
