import type { Assignment } from '@shared/contract/index.ts';
import { Phone, UserRound } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { ConfirmDialog } from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useCan } from '@/features/access/permissions/can';
import { unassignDriver } from '@/features/drivers/api/drivers-api';
import { formatSince, telHref } from '@/features/drivers/lib/driver-format';
import { useVehicleDriver } from '@/features/drivers/lib/use-vehicle-driver';
import { emitAssignment } from '@/features/drivers/use-assignment-events';
import { useNow } from '@/shared/hooks/use-now';
import { Button } from '@/shared/ui/button';
import { SectionLabel, Skeleton, Tile } from './details-ui';

// The dialog (search + confirm) is its own chunk, loaded on the first click.
const AssignDialog = lazy(() =>
  import('@/features/drivers/components/assign-dialog').then((m) => ({ default: m.AssignDialog })),
);

export interface DriverSectionProps {
  vehicleId: string;
  regno: string | null;
  fleetId: string | null;
}

/**
 * F12-R5 / D-096: the Overview tab's Driver section. Name, phone (`tel:`), "since 3 d"; with
 * `drivers.manage` also Assign / Change / Unassign in place. Live via WS `assignment` events.
 */
export function DriverSection({ vehicleId, regno, fleetId }: DriverSectionProps) {
  const manage = useCan('drivers.manage');
  const res = useVehicleDriver(vehicleId);
  const now = useNow(60_000);
  const [assigning, setAssigning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const driver = res.data?.driver ?? null;
  const current = res.data?.current ?? null;
  const label = regno ?? vehicleId;

  const unassign = async () => {
    if (!driver) return;
    setPending(true);
    setError(null);
    try {
      await unassignDriver(driver.id);
      const at = Date.now();
      emitAssignment(
        current
          ? { ...current, to: at }
          : { id: `local-${driver.id}`, driverId: driver.id, vehicleId, from: at, to: at, by: '' },
      );
      setUnassigning(false);
    } catch (err) {
      setError(errorText(err));
      setUnassigning(false);
    } finally {
      setPending(false);
    }
  };

  const onAssigned = (a: Assignment, closed: Assignment[]) => {
    for (const c of closed) emitAssignment(c);
    emitAssignment(a);
  };

  return (
    <Tile className="flex flex-col gap-2" data-testid="driver-section">
      <div className="flex items-center gap-2">
        <SectionLabel>Driver</SectionLabel>
        {manage && res.data && (
          <span className="ml-auto flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setLoaded(true);
                setAssigning(true);
              }}
            >
              {driver ? 'Change' : 'Assign'}
            </Button>
            {driver && (
              <Button size="xs" variant="outline" onClick={() => setUnassigning(true)}>
                Unassign
              </Button>
            )}
          </span>
        )}
      </div>
      {res.error && !res.data ? (
        <p className="text-xs text-text-muted">Couldn’t load the driver.</p>
      ) : !res.data ? (
        <Skeleton className="h-10" label="driver" />
      ) : driver ? (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <UserRound className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" data-testid="driver-name">
              {driver.name}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
              <a
                href={telHref(driver.phone)}
                className="inline-flex items-center gap-1 hover:text-accent"
                aria-label={`Call ${driver.name}`}
              >
                <Phone className="size-3" aria-hidden />
                {driver.phone}
              </a>
              {current && (
                <span data-testid="driver-since">since {formatSince(current.from, now)}</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted" data-testid="driver-none">
          No driver assigned
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {manage && loaded && (
        <Suspense fallback={null}>
          <AssignDialog
            open={assigning}
            onOpenChange={setAssigning}
            target={{
              mode: 'driver',
              vehicle: { vehicleId, regno: label, fleetId },
              currentDriver: driver,
            }}
            onAssigned={onAssigned}
          />
        </Suspense>
      )}
      {manage && driver && (
        <ConfirmDialog
          open={unassigning}
          onOpenChange={setUnassigning}
          title={`Unassign ${driver.name}?`}
          description={`${label} will have no driver. The history is kept.`}
          confirmLabel="Unassign"
          pending={pending}
          onConfirm={() => void unassign()}
        />
      )}
    </Tile>
  );
}
