import {
  REQUEST_STATUSES,
  REQUEST_TYPES,
  type DriverRequest,
  type Fleet,
} from '@shared/contract/index.ts';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronDown, Search, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { listFleets } from '@/features/access/api/access-api';
import { AdminLayout } from '@/features/access/components/admin-layout';
import { FilterSelect, LoadError } from '@/features/access/components/admin-ui';
import { FleetPicker } from '@/features/access/fleets/fleet-picker';
import { useResource } from '@/features/access/lib/use-resource';
import { inputClass } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { getRequest } from '../api/requests-api';
import { FleetAutoAssignToggle } from '../components/fleet-auto-assign-toggle';
import { RequestDrawer } from '../components/request-drawer';
import { RequestTable } from '../components/request-table';
import { driverOf, regnoOf, useRequestLookups } from '../lib/request-lookups';
import { STATUS_META, TYPE_LABEL } from '../lib/request-model';
import type { StatusFilter, TypeFilter } from '../request-desk-store';
import { useRequestDesk } from '../use-request-desk';

export const REQUEST_SEARCH_DEBOUNCE_MS = 200;

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  ...REQUEST_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })),
];
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open requests' },
  { value: 'all', label: 'All statuses' },
  ...REQUEST_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
];

const driverName = (id: string) => driverOf(id)?.name ?? null;

/**
 * `/requests` (F14-R1): the operator request desk. Every request in scope from the live desk
 * store, filtered by type, status (open by default), fleet subtree and reg no / driver search.
 * `/requests/$requestId` renders the drawer (`<Outlet />`) over it.
 */
export function RequestDeskPage() {
  const { store, state } = useRequestDesk((s) => s);
  useEffect(() => store.retain(), [store]);
  const fleetsRes = useResource((signal) => listFleets({ signal }));
  const fleets = useMemo(() => fleetsRes.data ?? [], [fleetsRes.data]);
  useEffect(() => store.setFleets(fleets), [store, fleets]);
  useRequestLookups(state.items);

  const { filter } = state;
  const [text, setText] = useState(filter.q);
  useEffect(() => {
    const t = setTimeout(() => store.setFilter({ q: text }), REQUEST_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, store]);

  const navigate = useNavigate();
  const { requestId } = useParams({ strict: false }) as { requestId?: string };
  const fleetLabel = filter.fleetId
    ? (fleets.find((f) => f.id === filter.fleetId)?.name ?? 'Fleet')
    : 'All fleets';

  return (
    <AdminLayout
      title="Requests"
      description="Breakdown, replacement and roadside requests from drivers in your fleets."
      actions={filter.fleetId && <FleetAutoAssignToggle fleetId={filter.fleetId} />}
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
            placeholder="Search reg no or driver"
            aria-label="Search requests"
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </label>
        <FilterSelect
          label="Filter by type"
          value={filter.type}
          onChange={(v) => store.setFilter({ type: v as TypeFilter })}
          options={TYPE_OPTIONS}
        />
        <FilterSelect
          label="Filter by status"
          value={filter.status}
          onChange={(v) => store.setFilter({ status: v as StatusFilter })}
          options={STATUS_OPTIONS}
        />
        <FleetFilter
          fleets={fleets}
          value={filter.fleetId}
          label={fleetLabel}
          onChange={(fleetId) => store.setFilter({ fleetId })}
        />
        <span className="ml-auto text-xs text-text-muted tabular-nums" aria-live="polite">
          <span data-testid="desk-count">{state.rows.length}</span> shown ·{' '}
          <span data-testid="desk-open-count">{state.openCount}</span> open
        </span>
      </div>
      {state.status === 'error' && (
        <LoadError message="Couldn't load requests." onRetry={() => void store.reload()} />
      )}
      <RequestTable
        rows={state.rows}
        loading={state.status !== 'ready'}
        highlighted={state.highlighted}
        selectedId={requestId ?? null}
        regnoOf={regnoOf}
        driverNameOf={driverName}
        onOpen={(id) => void navigate({ to: '/requests/$requestId', params: { requestId: id } })}
        empty={state.items.length === 0 ? 'No requests yet.' : 'No requests match these filters.'}
      />
      <Outlet />
    </AdminLayout>
  );
}

/** `/requests/$requestId`: the drawer over the desk, from the store (or fetched for deep links). */
export function RequestDrawerRoute() {
  const { requestId = '' } = useParams({ strict: false }) as { requestId?: string };
  const { store, state: fromStore } = useRequestDesk((s) =>
    s.items.find((r) => r.id === requestId),
  );
  const ready = useRequestDesk((s) => s.status === 'ready').state;
  const fetched = useResource<DriverRequest | null>(
    (signal) => (fromStore || !ready ? Promise.resolve(null) : getRequest(requestId, { signal })),
    `${requestId}:${ready}:${!!fromStore}`,
  );
  const request = fromStore ?? fetched.data ?? null;
  useRequestLookups(useMemo(() => (request ? [request] : []), [request]));
  const navigate = useNavigate();
  const d = request ? driverOf(request.driverId) : undefined;

  return (
    <RequestDrawer
      key={requestId}
      request={request}
      loading={!ready || fetched.loading}
      error={fetched.error}
      onClose={() => void navigate({ to: '/requests' })}
      onUpdated={(r) => store.upsert(r, false)}
      regnoOf={regnoOf}
      driver={d === undefined ? undefined : d && { name: d.name, phone: d.phone }}
      fleetName={request ? store.fleetName(request.fleetId) : undefined}
      replacementRequestId={
        request ? (store.openReplacementFor(request.driverId)?.id ?? null) : null
      }
    />
  );
}

/** F03 fleet picker in a popover (as on the drivers page). */
function FleetFilter({
  fleets,
  value,
  onChange,
  label,
}: {
  fleets: readonly Fleet[];
  value: string | null;
  onChange: (fleetId: string | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="outline" className="h-10 max-w-56" aria-label="Filter by fleet">
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-50 w-[min(320px,calc(100vw-32px))] rounded-tile border border-glass-border bg-surface-solid shadow-[0_16px_40px_var(--shadow)]"
          >
            <FleetPicker
              mode="single"
              aria-label="Fleet filter"
              placeholder="All fleets"
              fleets={fleets}
              value={value}
              onChange={(id) => {
                onChange(id);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear fleet filter"
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      )}
    </span>
  );
}
