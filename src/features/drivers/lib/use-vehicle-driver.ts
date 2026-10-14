import type { Assignment, Driver } from '@shared/contract/index.ts';
import { useResource } from '@/features/access/lib/use-resource';
import { vehicleAssignments, vehicleDriver } from '../api/drivers-api';
import { useAssignmentEvents } from '../use-assignment-events';

export interface VehicleDriverState {
  driver: Driver | null;
  /** The open assignment (its `from` is "since"). */
  current: Assignment | null;
}

/**
 * F12-R5: the vehicle's current driver and since when. Reloads on any `assignment` event that
 * touches this vehicle or its current driver (WS `events`, or a local echo).
 */
export function useVehicleDriver(vehicleId: string) {
  const res = useResource<VehicleDriverState>(async (signal) => {
    const [driver, history] = await Promise.all([
      vehicleDriver(vehicleId, { signal }),
      vehicleAssignments(vehicleId, { signal }),
    ]);
    const current = driver
      ? (history.find((a) => a.to === null && a.driverId === driver.id) ?? null)
      : null;
    return { driver, current };
  }, vehicleId);
  useAssignmentEvents((a) => {
    if (a.vehicleId === vehicleId || a.driverId === res.data?.driver?.id) res.reload();
  });
  return res;
}
