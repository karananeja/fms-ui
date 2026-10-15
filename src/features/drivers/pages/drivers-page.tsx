import type { Assignment, Driver, DriverStatus, Fleet } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listFleets } from '@/features/access/api/access-api';
import { AdminLayout } from '@/features/access/components/admin-layout';
import {
  ConfirmDialog,
  LoadError,
  Modal,
  Segmented,
  SidePanel,
} from '@/features/access/components/admin-ui';
import { FleetFilter } from '@/features/access/fleets/fleet-filter';
import { buildFleetIndex, isInSubtree } from '@/features/access/fleets/fleet-tree-model';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { inputClass } from '@/features/auth/components/text-field';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { listDrivers, unassignDriver } from '../api/drivers-api';
import { AssignDialog } from '../components/assign-dialog';
import { AssignmentHistory } from '../components/assignment-history';
import { DriverForm } from '../components/driver-form';
import { currentAssignments, useCurrentAssignments } from '../lib/current-assignments';
import { APP_ACCESS_LABEL, appAccess, DRIVER_STATUS_META, formatSince } from '../lib/driver-format';
import { emitAssignment } from '../use-assignment-events';

export const DRIVER_SEARCH_DEBOUNCE_MS = 250;
const PAGE = 200;
const ROW_H = 44;
/** Load the next page when the last rendered row is this close to the end. */
const PREFETCH_ROWS = 40;

type StatusFilter = 'all' | DriverStatus;

interface Query {
  q: string;
  status: StatusFilter;
  fleetId: string | null;
}

interface ListState {
  key: string;
  items: Driver[];
  next: string | null;
  loading: boolean;
  error: unknown;
}

/** Cursor pages of `GET /api/drivers` for one query; `more()` loads the next page. */
function useDriverPages(query: Query) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<ListState>({
    key: '',
    items: [],
    next: null,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const inFlight = useRef<string | null>(null);

  const fetchPage = (cursor: string | undefined, reset: boolean, signal?: AbortSignal) => {
    const tag = `${key}#${cursor ?? ''}`;
    if (inFlight.current === tag) return;
    inFlight.current = tag;
    setState((s) => ({ ...(reset ? { ...s, key, items: [], next: null } : s), loading: true }));
    listDrivers(
      {
        q: query.q,
        status: query.status === 'all' ? undefined : query.status,
        fleetId: query.fleetId ?? undefined,
        cursor,
        limit: PAGE,
      },
      { signal },
    ).then(
      (page) => {
        if (signal?.aborted) return;
        inFlight.current = null;
        setState((s) =>
          s.key !== key
            ? s
            : {
                key,
                items: reset ? page.items : [...s.items, ...page.items],
                next: page.nextCursor,
                loading: false,
                error: null,
              },
        );
      },
      (error: unknown) => {
        if (signal?.aborted) return;
        inFlight.current = null;
        setState((s) => ({ ...s, loading: false, error }));
      },
    );
  };

  useEffect(() => {
    const ctrl = new AbortController();
    inFlight.current = null;
    fetchPage(undefined, true, ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch per query / reload only
  }, [key, tick]);

  return {
    ...state,
    more: () => {
      if (state.next && !state.loading && state.key === key) fetchPage(state.next, false);
    },
    reload: () => setTick((t) => t + 1),
    replace: (d: Driver) =>
      setState((s) => ({ ...s, items: s.items.map((x) => (x.id === d.id ? d : x)) })),
    prepend: (d: Driver) => setState((s) => ({ ...s, items: [d, ...s.items] })),
  };
}

/** `/admin/drivers` (F12-R1): virtualised drivers table with server search and filters. */
export function DriversPage() {
  const fleetsRes = useResource((signal) => listFleets({ signal }));
  const fleets = useMemo(() => fleetsRes.data ?? [], [fleetsRes.data]);
  const fleetName = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [fleetId, setFleetId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [invited, setInvited] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), DRIVER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const list = useDriverPages({ q, status, fleetId });
  const selected = list.items.find((d) => d.id === openId) ?? null;

  return (
    <AdminLayout
      title="Drivers"
      description="Drivers, their vehicle and app access."
      actions={
        <Button onClick={() => setCreating(true)} disabled={!fleets.length}>
          <Plus aria-hidden /> Add driver
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search drivers"
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </label>
        <FleetFilter
          fleets={fleets}
          value={fleetId}
          onChange={setFleetId}
          label={fleetId ? (fleetName.get(fleetId) ?? 'Fleet') : 'All fleets'}
        />
        <Segmented<StatusFilter>
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'off-duty', label: 'Off duty' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <span className="ml-auto text-xs text-text-muted tabular-nums" aria-live="polite">
          {list.items.length.toLocaleString('en-IN')}
          {list.next ? '+' : ''} drivers
        </span>
      </div>
      {list.error ? <LoadError message={errorText(list.error)} onRetry={list.reload} /> : null}
      <DriversTable
        rows={list.items}
        loading={list.loading}
        fleetName={fleetName}
        invited={invited}
        selectedId={openId}
        onOpen={setOpenId}
        onNearEnd={list.more}
      />
      <Modal open={creating} onOpenChange={setCreating} title="Add driver">
        {creating && (
          <DriverForm
            driver={null}
            fleets={fleets}
            onCancel={() => setCreating(false)}
            onSaved={(d, sentInvite) => {
              if (sentInvite) setInvited((s) => new Set(s).add(d.id));
              currentAssignments.set(d.id, null);
              list.prepend(d);
              setCreating(false);
              setOpenId(d.id);
            }}
          />
        )}
      </Modal>
      <SidePanel
        open={selected !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        title={selected?.name ?? ''}
        description={selected ? `${selected.phone} · ${fleetName.get(selected.fleetId) ?? ''}` : ''}
      >
        {selected && (
          <DriverPanel key={selected.id} driver={selected} fleets={fleets} onSaved={list.replace} />
        )}
      </SidePanel>
    </AdminLayout>
  );
}

const COLS =
  'grid grid-cols-[minmax(140px,1.4fr)_minmax(110px,1fr)_96px_minmax(110px,1fr)] md:grid-cols-[minmax(160px,1.4fr)_150px_minmax(120px,1fr)_96px_minmax(120px,1fr)_72px_90px] items-center gap-3 px-3';

function DriversTable({
  rows,
  loading,
  fleetName,
  invited,
  selectedId,
  onOpen,
  onNearEnd,
}: {
  rows: readonly Driver[];
  loading: boolean;
  fleetName: ReadonlyMap<string, string>;
  invited: ReadonlySet<string>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNearEnd: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow(60_000);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual (see fleet-tree)
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });
  const items = v.getVirtualItems();
  const last = items.at(-1)?.index ?? -1;
  const visibleIds = items.map((i) => rows[i.index]?.id).filter((id): id is string => !!id);
  const current = useCurrentAssignments(visibleIds);

  useEffect(() => {
    if (last >= rows.length - PREFETCH_ROWS) onNearEnd();
  }, [last, rows.length, onNearEnd]);

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-panel)] shadow-panel glass"
      role="table"
      aria-label="Drivers"
      aria-rowcount={rows.length}
      aria-busy={loading || undefined}
    >
      <div
        role="row"
        className={cn(
          COLS,
          'h-10 border-b border-glass-border bg-surface-solid text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase',
        )}
      >
        <span role="columnheader">Name</span>
        <span role="columnheader" className="hidden md:block">
          Phone
        </span>
        <span role="columnheader" className="hidden md:block">
          Fleet
        </span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Vehicle</span>
        <span role="columnheader" className="hidden md:block">
          Since
        </span>
        <span role="columnheader" className="hidden md:block">
          App
        </span>
      </div>
      <div
        ref={scrollRef}
        className="h-[calc(100dvh-280px)] min-h-72 overflow-auto"
        data-testid="drivers-scroll"
      >
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const d = rows[item.index]!;
            const cur = current.get(d.id);
            const meta = DRIVER_STATUS_META[d.status];
            return (
              <div
                key={d.id}
                role="row"
                data-row-key={d.id}
                aria-selected={d.id === selectedId}
                tabIndex={0}
                onClick={() => onOpen(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(d.id);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: ROW_H,
                  transform: `translateY(${item.start}px)`,
                }}
                className={cn(
                  COLS,
                  'cursor-pointer border-b border-glass-border/50 text-sm outline-none hover:bg-tile focus-visible:bg-tile focus-visible:shadow-[inset_2px_0_0_var(--accent)]',
                  d.id === selectedId && 'bg-accent-soft hover:bg-accent-soft',
                )}
              >
                <span role="cell" className="min-w-0">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-text-muted md:hidden">
                    {d.phone}
                  </span>
                </span>
                <span role="cell" className="hidden truncate text-text-muted md:block">
                  {d.phone}
                </span>
                <span role="cell" className="hidden truncate text-text-muted md:block">
                  {fleetName.get(d.fleetId) ?? d.fleetId}
                </span>
                <span role="cell">
                  <TintPill color={meta.color} data-status={d.status}>
                    {meta.label}
                  </TintPill>
                </span>
                <span role="cell" className="truncate">
                  {cur === undefined ? (
                    <span className="text-text-faint">…</span>
                  ) : cur ? (
                    <Link
                      to="/live-tracking"
                      search={{ vehicle: cur.assignment.vehicleId }}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-accent hover:underline"
                    >
                      {cur.regno}
                    </Link>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </span>
                <span role="cell" className="hidden text-xs text-text-muted tabular-nums md:block">
                  {cur ? formatSince(cur.assignment.from, now) : ''}
                </span>
                <span role="cell" className="hidden text-xs text-text-muted md:block">
                  {APP_ACCESS_LABEL[appAccess(d, invited)]}
                </span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-text-muted">
            {loading ? 'Loading…' : 'No drivers match these filters.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Driver drawer: current vehicle (assign / reassign / unassign), edit, and history (F12-R2…R4). */
function DriverPanel({
  driver,
  fleets,
  onSaved,
}: {
  driver: Driver;
  fleets: readonly Fleet[];
  onSaved: (d: Driver) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useCurrentAssignments([driver.id]).get(driver.id);
  const now = useNow(60_000);
  const inFleet = useMemo(() => {
    const index = buildFleetIndex(fleets);
    return (id: string) => isInSubtree(index, id, driver.fleetId);
  }, [fleets, driver.fleetId]);

  const unassign = async () => {
    if (!current) return;
    setPending(true);
    setError(null);
    try {
      await unassignDriver(driver.id);
      emitAssignment({ ...current.assignment, to: Date.now() });
      currentAssignments.set(driver.id, null);
      setUnassigning(false);
    } catch (err) {
      setError(errorText(err));
      setUnassigning(false);
    } finally {
      setPending(false);
    }
  };

  const onAssigned = (a: Assignment, closed: Assignment[]) => {
    if (current && current.assignment.vehicleId !== a.vehicleId)
      emitAssignment({ ...current.assignment, to: a.from });
    for (const c of closed) emitAssignment(c);
    emitAssignment(a);
  };

  if (editing)
    return (
      <DriverForm
        driver={driver}
        fleets={fleets}
        onCancel={() => setEditing(false)}
        onSaved={(d) => {
          onSaved(d);
          setEditing(false);
        }}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-tile border border-tile-border bg-tile p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            Vehicle
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={driver.status === 'disabled' || current === undefined}
              onClick={() => setAssigning(true)}
            >
              {current ? 'Reassign' : 'Assign'}
            </Button>
            {current && (
              <Button size="xs" variant="outline" onClick={() => setUnassigning(true)}>
                Unassign
              </Button>
            )}
          </span>
        </div>
        {current === undefined ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : current ? (
          <p className="text-sm" data-testid="panel-vehicle">
            <Link
              to="/live-tracking"
              search={{ vehicle: current.assignment.vehicleId }}
              className="font-semibold text-accent hover:underline"
            >
              {current.regno}
            </Link>
            <span className="text-text-muted">
              {' '}
              · since {formatSince(current.assignment.from, now)}
            </span>
          </p>
        ) : (
          <p className="text-sm text-text-muted" data-testid="panel-vehicle">
            No vehicle assigned
          </p>
        )}
        {driver.status === 'disabled' && (
          <p className="mt-1 text-xs text-text-muted">Disabled drivers can’t be assigned.</p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </section>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit driver
        </Button>
      </div>
      <section>
        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
          Assignment history
        </h3>
        <AssignmentHistory driverId={driver.id} />
      </section>
      <AssignDialog
        open={assigning}
        onOpenChange={setAssigning}
        target={{ mode: 'vehicle', driver, inFleet }}
        onAssigned={onAssigned}
      />
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title={`Unassign ${driver.name}?`}
        description={`${current?.regno ?? 'The vehicle'} will have no driver. The history is kept.`}
        confirmLabel="Unassign"
        pending={pending}
        onConfirm={() => void unassign()}
      />
    </div>
  );
}
