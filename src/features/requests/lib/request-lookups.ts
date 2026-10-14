import type { Driver, DriverRequest } from '@shared/contract/index.ts';
import { useEffect, useSyncExternalStore } from 'react';
import { can } from '@/features/access/permissions/can';
import { sessionStore } from '@/features/auth/session/session-store';
import { vehicleDriver } from '@/features/drivers/api/drivers-api';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { apiFetch } from '@/shared/api/api-client';
import { requestDeskStore } from '../request-desk-store';

/**
 * F14: requests carry ids only. Reg nos come from the live worker (`live.view`, already running in
 * the shell). Drivers come from `GET /drivers/:id` with `drivers.manage`, else from the vehicle's
 * current driver (`vehicle.details.view`) on the request's vehicle or its replacement. Results
 * are cached for the session and fed to the desk store as search labels.
 */

const regnos = new Map<string, string | null>();
const drivers = new Map<string, Driver | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  for (const l of listeners) l();
};

const RETRY_MS = 1500;
const RETRIES = 8;

/** The worker may still be loading its snapshot: retry a few times before giving up. */
async function loadRegno(vehicleId: string, attempt = 0): Promise<void> {
  const s = await liveTrackingStore.vehicleSummary(vehicleId).catch(() => null);
  if (!s && attempt < RETRIES && liveTrackingStore.running) {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    return loadRegno(vehicleId, attempt + 1);
  }
  regnos.set(vehicleId, s?.regno ?? null);
  if (s?.regno) requestDeskStore.setLabel(vehicleId, s.regno);
}

async function loadDriver(r: DriverRequest): Promise<void> {
  const me = sessionStore.getSnapshot().me;
  let d: Driver | null = null;
  if (can(me, 'drivers.manage')) {
    d = await apiFetch<Driver>(`/api/drivers/${encodeURIComponent(r.driverId)}`).catch(() => null);
  }
  if (!d && can(me, 'vehicle.details.view')) {
    const vehicles = [r.replacement?.assignedVehicleId, r.vehicleId].filter(
      (v): v is string => !!v,
    );
    for (const v of vehicles) {
      const cur = await vehicleDriver(v).catch(() => null);
      if (cur?.id === r.driverId) {
        d = cur;
        break;
      }
    }
  }
  drivers.set(r.driverId, d);
  if (d) requestDeskStore.setLabel(r.driverId, d.name);
}

/** Starts the lookups `r` still needs (each id once per session). */
export function resolveRequest(r: DriverRequest): void {
  const jobs: Promise<void>[] = [];
  if (!regnos.has(r.vehicleId) && !pending.has(r.vehicleId)) {
    pending.add(r.vehicleId);
    jobs.push(loadRegno(r.vehicleId).finally(() => pending.delete(r.vehicleId)));
  }
  const replacement = r.replacement?.assignedVehicleId ?? r.replacement?.suggestedVehicleId;
  if (replacement && !regnos.has(replacement) && !pending.has(replacement)) {
    pending.add(replacement);
    jobs.push(loadRegno(replacement).finally(() => pending.delete(replacement)));
  }
  if (!drivers.has(r.driverId) && !pending.has(r.driverId)) {
    pending.add(r.driverId);
    jobs.push(loadDriver(r).finally(() => pending.delete(r.driverId)));
  }
  if (jobs.length) void Promise.all(jobs).then(emit);
}

/** Drops a driver entry so it is looked up again (after a replacement moved the driver). */
export function forgetDriver(driverId: string): void {
  drivers.delete(driverId);
}

export const regnoOf = (vehicleId: string) => regnos.get(vehicleId) ?? null;
/** `undefined` while unknown, `null` when it can't be found. */
export const driverOf = (driverId: string) => drivers.get(driverId);

/** Clears the caches (sign-out, tests). */
export function resetLookups(): void {
  regnos.clear();
  drivers.clear();
  emit();
}

// A different user starts with empty caches.
let userId: string | null = null;
sessionStore.subscribe(() => {
  const next = sessionStore.getSnapshot().me?.user.id ?? null;
  if (next !== userId) {
    userId = next;
    regnos.clear();
    drivers.clear();
  }
});

/** Re-renders when any lookup lands; resolves `items` (all of them; volumes are small). */
export function useRequestLookups(items: readonly DriverRequest[]): number {
  useEffect(() => {
    for (const r of items) resolveRequest(r);
  }, [items]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
