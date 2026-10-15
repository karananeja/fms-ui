import type { ShareLink } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminLayout } from '@/features/access/components/admin-layout';
import {
  DataTable,
  LoadError,
  Segmented,
  type Column,
} from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { inputClass } from '@/features/auth/components/text-field';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { listShareLinks, lookupRegno } from '../api/share-api';
import {
  canRevokeLink,
  newestFirst,
  shareLinkStatus,
  type ShareLinkStatus,
} from '../lib/share-link-model';
import {
  CopyLinkButton,
  ExpiryWhen,
  OptionChips,
  RevokeButton,
  ShareStatusPill,
} from './share-link-list';
import { useCreatorName, useRevokeFlow } from './use-share-links';

type StatusFilter = ShareLinkStatus | 'all';
const FILTERS: readonly StatusFilter[] = ['active', 'expired', 'revoked', 'all'];
const FILTER_LABEL: Record<StatusFilter, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  all: 'All',
};

/**
 * Regnos for the listed vehicles (D-088): links carry only `vehicleId`, so each distinct vehicle
 * is looked up once; until then (or when it can't be) the ID is shown.
 */
function useRegnos(links: readonly ShareLink[], now: number): ReadonlyMap<string, string> {
  const canListVehicles = useCan('fleets.manage');
  const [regnos, setRegnos] = useState<ReadonlyMap<string, string>>(() => new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const vehicleId of new Set(links.map((l) => l.vehicleId))) {
      if (asked.current.has(vehicleId)) continue;
      const activeToken = links.find(
        (l) => l.vehicleId === vehicleId && shareLinkStatus(l, now) === 'active',
      )?.token;
      if (!canListVehicles && !activeToken) continue;
      asked.current.add(vehicleId);
      void lookupRegno(vehicleId, { canListVehicles, activeToken }).then((regno) => {
        if (regno) setRegnos((m) => new Map(m).set(vehicleId, regno));
      });
    }
  }, [links, canListVehicles, now]);
  return regnos;
}

/** `/admin/share-links` (F10-R7): every share link in your scope, by status, with revoke. */
export function ShareLinksPage() {
  const me = useSession(selectMe);
  const canRevokeAny = useCan('share.revoke');
  const creatorName = useCreatorName(me?.user.id);
  const now = useNow(30_000);
  const res = useResource((signal) => listShareLinks({}, { signal }));
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [query, setQuery] = useState('');

  const links = useMemo(() => [...(res.data ?? [])].sort(newestFirst), [res.data]);
  const regnos = useRegnos(links, now);
  const regnoOf = (l: ShareLink) => regnos.get(l.vehicleId) ?? l.vehicleId;

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: links.length,
      active: 0,
      expired: 0,
      revoked: 0,
    };
    for (const l of links) c[shareLinkStatus(l, now)]++;
    return c;
  }, [links, now]);

  const q = query.trim().toLowerCase();
  const rows = links.filter(
    (l) =>
      (filter === 'all' || shareLinkStatus(l, now) === filter) &&
      (!q || regnoOf(l).toLowerCase().includes(q) || l.vehicleId.toLowerCase().includes(q)),
  );

  const revoke = useRevokeFlow((link) =>
    res.setData((d) => d?.map((l) => (l.id === link.id ? link : l))),
  );

  const columns: Column<ShareLink>[] = [
    {
      id: 'vehicle',
      header: 'Vehicle',
      cell: (l) => (
        <Link
          to="/live-tracking"
          search={{ vehicle: l.vehicleId }}
          className="font-semibold whitespace-nowrap text-accent hover:underline"
          data-testid="share-row-regno"
        >
          {regnoOf(l)}
        </Link>
      ),
    },
    {
      id: 'by',
      header: 'Created by',
      className: 'hidden md:table-cell',
      cell: (l) => <span className="text-text-muted">{creatorName(l.createdBy)}</span>,
    },
    {
      id: 'created',
      header: 'Created',
      className: 'hidden lg:table-cell',
      cell: (l) => <ExpiryWhen at={l.createdAt} now={now} />,
    },
    {
      id: 'expires',
      header: 'Expires',
      className: 'hidden sm:table-cell',
      cell: (l) => <ExpiryWhen at={l.expiresAt} now={now} />,
    },
    {
      id: 'options',
      header: 'Options',
      className: 'hidden md:table-cell',
      cell: (l) => <OptionChips link={l} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (l) => <ShareStatusPill status={shareLinkStatus(l, now)} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-0 text-right',
      cell: (l) => (
        <div className="flex justify-end gap-0.5">
          <CopyLinkButton link={l} label={`Copy link for ${regnoOf(l)}`} />
          {shareLinkStatus(l, now) === 'active' && canRevokeLink(l, me?.user.id, canRevokeAny) && (
            <RevokeButton
              label={`Revoke link for ${regnoOf(l)}`}
              disabled={revoke.pending}
              onClick={() => revoke.request(l)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <AdminLayout
      title="Share links"
      description="Public live-location links for vehicles in your fleets. Times are IST."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          label="Filter by status"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
        />
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search by regno</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            placeholder="Search regno"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </label>
      </div>
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      <DataTable
        label="Share links"
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        loading={res.loading}
        empty={
          q
            ? `No ${filter === 'all' ? '' : `${FILTER_LABEL[filter].toLowerCase()} `}links match "${query.trim()}".`
            : `No ${filter === 'all' ? '' : `${FILTER_LABEL[filter].toLowerCase()} `}share links.`
        }
      />
      {revoke.dialog}
    </AdminLayout>
  );
}
