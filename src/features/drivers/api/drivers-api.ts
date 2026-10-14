import type {
  Assignment,
  Driver,
  DriverStatus,
  VehicleMeta,
  createDriverSchema,
  updateDriverSchema,
} from '@shared/contract/index.ts';
import type { z } from 'zod';
import { apiFetch } from '@/shared/api/api-client';

/**
 * F12: typed calls for the F11 driver endpoints. Every call throws `ApiError` on non-2xx;
 * 409 `conflict` = the vehicle already has a driver / the driver is disabled, 422 = validation.
 */

export type CreateDriverInput = z.input<typeof createDriverSchema>;
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export interface DriverListQuery {
  /** Substring of the name or phone (server side). */
  q?: string;
  /** Subtree of this fleet. */
  fleetId?: string;
  status?: DriverStatus;
  cursor?: string;
  limit?: number;
}

export interface DriverPage {
  items: Driver[];
  nextCursor: string | null;
}

interface Opts {
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

export function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** `GET /api/drivers`: one cursor page (`drivers.manage`). */
export const listDrivers = (q: DriverListQuery = {}, opts?: Opts) =>
  apiFetch<DriverPage>(
    `/api/drivers${query({ q: q.q?.trim(), fleetId: q.fleetId, status: q.status, cursor: q.cursor, limit: q.limit })}`,
    opts,
  );

/** `POST /api/drivers` (201); `invite: true` + `email` also sends an F03 invite (role Driver). */
export const createDriver = (input: CreateDriverInput) =>
  apiFetch<Driver>('/api/drivers', { body: input });

export const updateDriver = (id: string, patch: UpdateDriverInput) =>
  apiFetch<Driver>(`/api/drivers/${enc(id)}`, { method: 'PATCH', body: patch });

/** `PUT /api/drivers/:id/assignment`: moves the driver onto the vehicle; 409 if it has a driver. */
export const assignVehicle = (driverId: string, vehicleId: string) =>
  apiFetch<Assignment>(`/api/drivers/${enc(driverId)}/assignment`, {
    method: 'PUT',
    body: { vehicleId },
  });

/** `DELETE /api/drivers/:id/assignment` (204). */
export const unassignDriver = (driverId: string) =>
  apiFetch<void>(`/api/drivers/${enc(driverId)}/assignment`, { method: 'DELETE' });

/** `GET /api/assignments?driverId`: history, newest first. */
export const driverAssignments = (driverId: string, opts?: Opts) =>
  apiFetch<Assignment[]>(`/api/assignments${query({ driverId })}`, opts);

/** `GET /api/assignments?vehicleId`: history, newest first. */
export const vehicleAssignments = (vehicleId: string, opts?: Opts) =>
  apiFetch<Assignment[]>(`/api/assignments${query({ vehicleId })}`, opts);

/** `GET /api/vehicles/:id/driver`: the current driver, or `null`. */
export const vehicleDriver = (vehicleId: string, opts?: Opts) =>
  apiFetch<Driver | null>(`/api/vehicles/${enc(vehicleId)}/driver`, opts);

/** `GET /api/vehicles?q` (`fleets.manage`): vehicles whose id / regno / VIN / device id contain `q`. */
export const searchVehicles = (q: string, limit = 50, opts?: Opts) =>
  apiFetch<{ items: VehicleMeta[]; nextCursor: string | null }>(
    `/api/vehicles${query({ q: q.trim(), limit })}`,
    opts,
  );

/**
 * Reassign (F12-R3): ends `currentDriverId`'s assignment on the vehicle (if another driver has
 * it), then puts `driverId` on it. The server still answers 409 if someone else took it meanwhile.
 */
export async function reassignVehicle(
  driverId: string,
  vehicleId: string,
  currentDriverId: string | null,
): Promise<Assignment> {
  if (currentDriverId && currentDriverId !== driverId) await unassignDriver(currentDriverId);
  return assignVehicle(driverId, vehicleId);
}
