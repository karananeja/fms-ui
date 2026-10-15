import type { Assignment, User } from '@shared/contract/index.ts';
import { listUsers } from '@/features/access/api/access-api';
import { LoadError } from '@/features/access/components/admin-ui';
import { errorText, formatIstShort } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { driverAssignments } from '../api/drivers-api';
import { useAssignmentEvents } from '../use-assignment-events';

interface Row extends Assignment {
  regno: string;
  byName: string;
}

/** Who made an assignment: a user's name when known, `System` for seed/auto ones. */
function byLabel(by: string, users: ReadonlyMap<string, User>): string {
  if (by === 'system') return 'System';
  return users.get(by)?.name ?? by;
}

/**
 * F12-R4: a driver's assignment history, newest first (vehicle, from → to, by whom; IST).
 * Reg nos come from the live worker when it runs, else the vehicle id is shown.
 */
export function AssignmentHistory({ driverId }: { driverId: string }) {
  const canUsers = useCan('users.manage');
  const res = useResource<Row[]>(async (signal) => {
    const [list, users] = await Promise.all([
      driverAssignments(driverId, { signal }),
      canUsers ? listUsers({ signal }).catch(() => []) : Promise.resolve<User[]>([]),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const summaries = await Promise.all(
      list.map((a) => liveTrackingStore.vehicleSummary(a.vehicleId).catch(() => null)),
    );
    return list.map((a, k) => ({
      ...a,
      regno: summaries[k]?.regno ?? a.vehicleId,
      byName: byLabel(a.by, byId),
    }));
  }, `${driverId}:${canUsers}`);
  useAssignmentEvents((a) => {
    if (a.driverId === driverId) res.reload();
  });

  if (res.error && !res.data)
    return <LoadError message={errorText(res.error)} onRetry={res.reload} />;
  if (!res.data) return <p className="text-sm text-text-muted">Loading…</p>;
  if (!res.data.length)
    return (
      <p className="text-sm text-text-muted" data-testid="history-empty">
        No assignments yet.
      </p>
    );
  return (
    <ol aria-label="Assignment history" className="flex flex-col gap-2" data-testid="history">
      {res.data.map((a) => (
        <li
          key={a.id}
          data-testid="history-row"
          className="rounded-tile border border-tile-border bg-tile px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{a.regno}</span>
            {a.to === null && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-accent uppercase">
                Current
              </span>
            )}
          </div>
          <div className="mt-0.5 text-text-muted tabular-nums">
            {formatIstShort(a.from)} → {a.to === null ? 'now' : formatIstShort(a.to)}
          </div>
          <div className="text-text-faint">by {a.byName}</div>
        </li>
      ))}
    </ol>
  );
}
