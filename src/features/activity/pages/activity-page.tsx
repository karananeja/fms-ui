import {
  ACTION_AREAS,
  ACTION_KINDS,
  type ActionArea,
  type AuditEntry,
  type AuditQuery,
} from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  ChevronDown,
  Download,
  ExternalLink,
  MessageSquare,
  Search,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminLayout } from '@/features/access/components/admin-layout';
import { FilterSelect, LoadError } from '@/features/access/components/admin-ui';
import { errorText, formatIstShort } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { inputClass } from '@/features/auth/components/text-field';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { DateRangePicker } from '@/shared/ui/date-range-picker';
import { auditCsvUrl, listAudit, undoAction } from '../api/activity-api';
import { AREA_ICON, AREA_LABEL, AUDIT_STATUS, istDayMs, targetHref } from '../lib/activity-format';

const ALL = '';

/** Debounced copy of `value`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * `/admin/activity` (F29, D-167): the audit log of assistant actions as a working screen —
 * filters, CSV export, and per entry What changed, Undo, Open target and Open chat. Times IST.
 */
export function ActivityPage() {
  const [user, setUser] = useState(ALL);
  const [area, setArea] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

  const query = useMemo<Partial<AuditQuery>>(
    () => ({
      user: user || undefined,
      area: (area || undefined) as ActionArea | undefined,
      kind: kind || undefined,
      from: from ? istDayMs(from, 'start') : undefined,
      to: to ? istDayMs(to, 'end') : undefined,
      q: q || undefined,
    }),
    [user, area, kind, from, to, q],
  );
  const key = JSON.stringify(query);
  const res = useResource((signal) => listAudit(query, { signal }), key);
  const [extra, setExtra] = useState<{ key: string; items: AuditEntry[]; cursor: string | null }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const more = extra?.key === key ? extra : undefined;
  const items = [...(res.data?.items ?? []), ...(more?.items ?? [])];
  const cursor = more ? more.cursor : (res.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listAudit({ ...query, before: Number(cursor) });
      setExtra({ key, items: [...(more?.items ?? []), ...page.items], cursor: page.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  };

  const reload = () => {
    setExtra(undefined);
    res.reload();
  };

  const filtered = !!(user || area || kind || from || to || q);

  return (
    <AdminLayout
      title="Activity"
      description="Changes made through the assistant, with Undo. Times are IST."
      actions={
        <Button variant="outline" asChild>
          <a href={auditCsvUrl(query)} download data-testid="activity-export">
            <Download aria-hidden />
            Export CSV
          </a>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Filter by user"
          value={user}
          onChange={setUser}
          options={[
            { value: ALL, label: 'All users' },
            ...(res.data?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <FilterSelect
          label="Filter by area"
          value={area}
          onChange={setArea}
          options={[
            { value: ALL, label: 'All areas' },
            ...ACTION_AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] })),
          ]}
        />
        <FilterSelect
          label="Filter by action"
          value={kind}
          onChange={setKind}
          options={[
            { value: ALL, label: 'All actions' },
            ...ACTION_KINDS.map((k) => ({ value: k, label: k })),
          ]}
        />
        {/* D-170: shadcn date-range picker; days are IST (istDayMs). */}
        <DateRangePicker
          label="Filter by date"
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <label className="relative w-full sm:ml-auto sm:w-64">
          <span className="sr-only">Search activity</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </label>
      </div>

      {res.error ? <LoadError message={errorText(res.error)} onRetry={reload} /> : null}

      <ul
        aria-label="Activity"
        aria-busy={res.loading || undefined}
        className="divide-y divide-glass-border overflow-hidden rounded-[var(--radius-panel)] shadow-panel glass"
      >
        {items.map((e) => (
          <ActivityRow key={e.id} entry={e} onUndone={reload} />
        ))}
        {!res.loading && items.length === 0 && !res.error && (
          <li className="p-6 text-center text-sm text-text-muted">
            {filtered ? 'Nothing matches these filters.' : 'No activity yet.'}
          </li>
        )}
        {res.loading && items.length === 0 && (
          <li className="p-6 text-center text-sm text-text-muted">Loading…</li>
        )}
      </ul>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </AdminLayout>
  );
}

function ActivityRow({ entry: e, onUndone }: { entry: AuditEntry; onUndone: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = AREA_ICON[e.area];
  const status = AUDIT_STATUS[e.status];
  const href = targetHref(e.target);

  const undo = async () => {
    if (!e.actionId) return;
    setPending(true);
    setError(null);
    try {
      await undoAction(e.actionId);
      setConfirming(false);
      onUndone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <li
      data-testid="activity-row"
      data-kind={e.kind}
      data-status={e.status}
      className="p-3 sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <p className="truncate text-sm font-semibold text-text">{e.summary}</p>
          <p className="truncate text-xs text-text-muted">
            <time dateTime={new Date(e.at).toISOString()}>{formatIstShort(e.at)}</time> ·{' '}
            {e.actorName} · <span className="font-mono">{e.kind}</span>
          </p>
        </div>
        <span className="rounded-full border border-tile-border bg-tile px-2.5 py-1 text-[11px] font-semibold text-text-muted">
          {AREA_LABEL[e.area]}
        </span>
        <TintPill color={status.color} data-status={e.status}>
          {status.label}
        </TintPill>
        {e.targetChanged && e.status === 'done' && (
          <span className="text-xs text-text-muted">Changed since</span>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {e.changes.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              What changed
              <ChevronDown
                aria-hidden
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </Button>
          )}
          {e.undoable && !confirming && (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              <Undo2 aria-hidden />
              Undo
            </Button>
          )}
          {href && <TargetLink entry={e} />}
          {e.threadId && (
            <Button variant="ghost" size="sm" asChild>
              {e.dashboardId ? (
                <Link to="/dashboards/$id" params={{ id: e.dashboardId }}>
                  <MessageSquare aria-hidden />
                  Open chat
                </Link>
              ) : (
                <Link to="/admin/activity" search={{ thread: e.threadId }}>
                  <MessageSquare aria-hidden />
                  Open chat
                </Link>
              )}
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <div
          role="group"
          aria-label="Confirm undo"
          className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-tile border border-tile-border bg-tile p-2 text-sm"
        >
          <span className="mr-auto text-text-muted">Undo “{e.summary}”?</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button size="sm" disabled={pending} onClick={() => void undo()}>
            Yes, undo
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {open && (
        <table className="mt-2 w-full text-xs" aria-label="What changed">
          <thead className="text-left text-text-faint">
            <tr>
              <th className="py-1 pr-3 font-semibold">Field</th>
              <th className="py-1 pr-3 font-semibold">Before</th>
              <th className="py-1 font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            {e.changes.map((c, k) => (
              <tr key={k} className="border-t border-glass-border">
                <td className="py-1 pr-3 text-text-muted">{c.label}</td>
                <td className="py-1 pr-3 text-text-muted">{c.before ?? '—'}</td>
                <td className="py-1 text-text">
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight aria-hidden className="size-3 text-text-faint" />
                    {c.after ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

/** "Open target": the admin page of the driver, user, fleet, request or share link. */
function TargetLink({ entry: e }: { entry: AuditEntry }) {
  const t = e.target!;
  const body = (
    <>
      <ExternalLink aria-hidden />
      Open {t.type === 'share_link' ? 'share link' : t.type}
    </>
  );
  const link =
    t.type === 'request' ? (
      <Link to="/requests/$requestId" params={{ requestId: t.id }}>
        {body}
      </Link>
    ) : (
      <Link to={targetHref(t) as '/admin/fleets'}>{body}</Link>
    );
  return (
    <Button variant="ghost" size="sm" asChild>
      {link}
    </Button>
  );
}
