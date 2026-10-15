import type { Assignment, Driver } from '@shared/contract/index.ts';
import { Search, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useCan } from '@/features/access/permissions/can';
import { inputClass } from '@/features/auth/components/text-field';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { listDrivers, reassignVehicle, searchVehicles, vehicleDriver } from '../api/drivers-api';
import { DRIVER_STATUS_META, shortName } from '../lib/driver-format';

export const ASSIGN_SEARCH_DEBOUNCE_MS = 250;

export interface VehicleRef {
  vehicleId: string;
  regno: string;
  fleetId: string | null;
}

/**
 * `vehicle`: pick a vehicle for `driver` (drivers page; `inFleet` limits to the driver's fleet).
 * `driver`: pick a driver for `vehicle` (vehicle card; any driver in the user's scope).
 */
export type AssignTarget =
  | { mode: 'vehicle'; driver: Driver; inFleet?: (fleetId: string) => boolean }
  | { mode: 'driver'; vehicle: VehicleRef; currentDriver: Driver | null };

interface Option {
  id: string;
  title: string;
  detail: string;
}

/** Vehicles by reg no: the REST search with `fleets.manage`, else the live worker's index. */
async function findVehicles(
  q: string,
  viaApi: boolean,
  inFleet: ((fleetId: string) => boolean) | undefined,
  signal: AbortSignal,
): Promise<(Option & { vehicle: VehicleRef })[]> {
  if (!q.trim()) return [];
  if (viaApi) {
    const page = await searchVehicles(q, 100, { signal });
    return page.items
      .filter((v) => !inFleet || inFleet(v.fleetId))
      .slice(0, 20)
      .map((v) => ({
        id: v.vehicleId,
        title: v.regno,
        detail: `${v.make} ${v.model}`,
        vehicle: { vehicleId: v.vehicleId, regno: v.regno, fleetId: v.fleetId },
      }));
  }
  const list = await liveTrackingStore.suggest(q, 'regno');
  return list.map((s) => ({
    id: s.vehicleId,
    title: s.regno,
    detail: s.vin,
    vehicle: { vehicleId: s.vehicleId, regno: s.regno, fleetId: null },
  }));
}

/** F12-R3: search, pick, and confirm (with the "already driven by" warning) an assignment. */
export function AssignDialog({
  open,
  onOpenChange,
  target,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AssignTarget;
  onAssigned: (a: Assignment, closed: Assignment[]) => void;
}) {
  const title =
    target.mode === 'vehicle'
      ? `Assign a vehicle to ${target.driver.name}`
      : `Assign a driver to ${target.vehicle.regno}`;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        target.mode === 'vehicle'
          ? 'Search vehicles by reg no in the driver’s fleet.'
          : 'Search drivers by name or phone.'
      }
    >
      {open && (
        <AssignBody
          target={target}
          onCancel={() => onOpenChange(false)}
          onAssigned={(a, closed) => {
            onAssigned(a, closed);
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

type Picked = { vehicle: VehicleRef; driver: Driver; other: Driver | null };

function AssignBody({
  target,
  onCancel,
  onAssigned,
}: {
  target: AssignTarget;
  onCancel: () => void;
  onAssigned: (a: Assignment, closed: Assignment[]) => void;
}) {
  const viaApi = useCan('fleets.manage');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<(Option & { pick: () => Promise<Picked> })[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });
  const targetKey =
    target.mode === 'vehicle'
      ? `v:${target.driver.id}`
      : `d:${target.vehicle.vehicleId}:${target.currentDriver?.id ?? ''}`;

  useEffect(() => {
    const target = targetRef.current;
    const ctrl = new AbortController();
    const t = setTimeout(
      () => {
        setSearching(true);
        const run = async () => {
          if (target.mode === 'vehicle') {
            const found = await findVehicles(q, viaApi, target.inFleet, ctrl.signal);
            return found.map((o) => ({
              ...o,
              pick: async (): Promise<Picked> => ({
                vehicle: o.vehicle,
                driver: target.driver,
                other: await vehicleDriver(o.vehicle.vehicleId),
              }),
            }));
          }
          const page = await listDrivers({ q, limit: 20 }, { signal: ctrl.signal });
          return page.items
            .filter((d) => d.status !== 'disabled')
            .map((d) => ({
              id: d.id,
              title: d.name,
              detail: `${d.phone} · ${DRIVER_STATUS_META[d.status].label}`,
              pick: async (): Promise<Picked> => ({
                vehicle: target.vehicle,
                driver: d,
                other: target.currentDriver,
              }),
            }));
        };
        run().then(
          (list) => {
            if (ctrl.signal.aborted) return;
            setOptions(list);
            setSearching(false);
          },
          (err: unknown) => {
            if (ctrl.signal.aborted) return;
            setOptions([]);
            setSearching(false);
            setError(errorText(err));
          },
        );
      },
      q ? ASSIGN_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, targetKey, viaApi]);

  const pick = async (o: Option & { pick: () => Promise<Picked> }) => {
    setError(null);
    setChecking(true);
    try {
      setPicked(await o.pick());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const confirm = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    const other = picked.other && picked.other.id !== picked.driver.id ? picked.other : null;
    try {
      const a = await reassignVehicle(
        picked.driver.id,
        picked.vehicle.vehicleId,
        other?.id ?? null,
      );
      const closed: Assignment[] = other
        ? [
            {
              id: `local-${other.id}`,
              driverId: other.id,
              vehicleId: picked.vehicle.vehicleId,
              from: a.from,
              to: a.from,
              by: a.by,
            },
          ]
        : [];
      onAssigned(a, closed);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  if (picked) {
    const conflict = picked.other && picked.other.id !== picked.driver.id ? picked.other : null;
    const same = picked.other?.id === picked.driver.id;
    return (
      <div>
        <p className="mb-3 text-sm">
          <span className="font-semibold">{picked.driver.name}</span>
          {' → '}
          <span className="font-semibold">{picked.vehicle.regno}</span>
        </p>
        {conflict && (
          <p
            role="alert"
            data-testid="assign-conflict"
            className="mb-3 flex items-start gap-2 rounded-tile border border-warn/40 bg-warn/10 p-3 text-sm text-warn"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {picked.vehicle.regno} is driven by {shortName(conflict.name).replace(/\.?$/, '.')}{' '}
            Reassign?
          </p>
        )}
        {same && (
          <p className="mb-3 text-sm text-text-muted">
            {picked.driver.name} already drives {picked.vehicle.regno}.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPicked(null);
              setError(null);
            }}
          >
            Back
          </Button>
          <Button type="button" disabled={saving || same} onClick={() => void confirm()}>
            {saving ? 'Saving…' : conflict ? 'Reassign' : 'Assign'}
          </Button>
        </div>
      </div>
    );
  }

  const label = target.mode === 'vehicle' ? 'Search vehicles by reg no' : 'Search drivers by name';
  return (
    <div>
      <label className="relative mb-3 block">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
        />
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setError(null);
          }}
          placeholder={target.mode === 'vehicle' ? 'MH12…' : 'Driver name or phone'}
          aria-label={label}
          className={cn(inputClass, 'h-10 pl-9', target.mode === 'vehicle' && 'uppercase')}
        />
      </label>
      <ul
        aria-label="Results"
        aria-busy={searching || undefined}
        className="max-h-72 overflow-auto"
      >
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              disabled={checking}
              onClick={() => void pick(o)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none hover:bg-tile focus-visible:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{o.title}</span>
                <span className="block truncate text-xs text-text-muted">{o.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!searching && !options.length && (
        <p className="py-3 text-center text-sm text-text-muted">
          {target.mode === 'vehicle' && !q.trim()
            ? 'Type a reg no to search.'
            : target.mode === 'vehicle'
              ? 'No vehicles match in this fleet.'
              : 'No drivers match.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
