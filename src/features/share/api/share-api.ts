import type { createShareLinkSchema, PublicShare, ShareLink } from '@shared/contract/index.ts';
import type { z } from 'zod';
import { apiFetch } from '@/shared/api/api-client';

/**
 * F10a: typed calls for share links (F01 contract, D-027). Every call throws `ApiError` on
 * non-2xx: 422 `validation_failed` for a bad body, 403 without `share.create` or for a vehicle
 * outside your fleets, 403 when revoking a link you may not revoke.
 */

export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

export interface RequestOptions {
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

/** `POST /api/share-links` (201). */
export const createShareLink = (input: CreateShareLinkInput) =>
  apiFetch<ShareLink>('/api/share-links', { body: input });

/**
 * `GET /api/share-links[?vehicleId=]`: every status. With `share.revoke` it lists every link in
 * your scope; otherwise only your own.
 */
export const listShareLinks = (q: { vehicleId?: string } = {}, opts?: RequestOptions) =>
  apiFetch<ShareLink[]>(
    `/api/share-links${q.vehicleId ? `?vehicleId=${enc(q.vehicleId)}` : ''}`,
    opts,
  );

/** `DELETE /api/share-links/:id` (204). */
export const revokeShareLink = (id: string) =>
  apiFetch<void>(`/api/share-links/${enc(id)}`, { method: 'DELETE' });

/**
 * The vehicle's regno for the admin list (D-088): share links carry only `vehicleId`. With
 * `fleets.manage` it comes from `GET /api/vehicles?q=`; otherwise from the public view of one
 * of the vehicle's active links. `null` when neither is possible (the list shows the ID).
 */
export async function lookupRegno(
  vehicleId: string,
  {
    canListVehicles,
    activeToken,
    signal,
  }: {
    canListVehicles: boolean;
    activeToken?: string;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  try {
    if (canListVehicles) {
      const page = await apiFetch<{ items: { vehicleId: string; regno: string }[] }>(
        `/api/vehicles?q=${enc(vehicleId)}&limit=5`,
        { signal },
      );
      return page.items.find((v) => v.vehicleId === vehicleId)?.regno ?? null;
    }
    if (activeToken) {
      const share = await apiFetch<PublicShare>(`/api/public/share/${enc(activeToken)}`, {
        signal,
      });
      return share.vehicle.regno;
    }
  } catch {
    // Fall back to the vehicle ID.
  }
  return null;
}
