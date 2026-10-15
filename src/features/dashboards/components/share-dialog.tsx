import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import type { DashboardShare, ShareAccess, ShareCandidate } from '@shared/contract/dashboards.ts';
import { Modal } from '@/features/access/components/admin-ui';
import { inputClass } from '@/features/auth/components/text-field';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import type { DashboardsApi } from '../api/dashboards-api';
import { formatUpdated } from '../lib/format';

export const SHARE_SEARCH_DEBOUNCE_MS = 250;
const LIMIT_TEXT = 'A dashboard can be shared with up to 50 people';

type Api = Pick<
  DashboardsApi,
  'shares' | 'addShares' | 'revokeShare' | 'candidates' | 'setShareAccess'
>;

const ACCESS_LABEL: Record<ShareAccess, string> = { view: 'Can view', edit: 'Can edit' };
const selectClass =
  'h-8 rounded-md border border-tile-border bg-tile px-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * §7: share a dashboard with people in your organisation; revoke access. F27 (D-150): each
 * person can view or edit; only the owner sees this dialog.
 */
export function ShareDialog({
  open,
  onOpenChange,
  dashboardId,
  title,
  api,
  onSharesChanged,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dashboardId: string;
  title: string;
  api: Api;
  onSharesChanged(count: number): void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share '${title}'`}
      description="People see widgets with their own data access. Editors can change widgets and use their own private chat; only you can share or delete."
    >
      {open && <ShareBody dashboardId={dashboardId} api={api} onSharesChanged={onSharesChanged} />}
    </Modal>
  );
}

function ShareBody({
  dashboardId,
  api,
  onSharesChanged,
}: {
  dashboardId: string;
  api: Api;
  onSharesChanged(count: number): void;
}) {
  const now = useNow(60_000);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<ShareCandidate[] | null>(null);
  const [shares, setShares] = useState<DashboardShare[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [access, setAccess] = useState<ShareAccess>('view');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), SHARE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.candidates(q, ctrl.signal).then(setCandidates, () => {
      if (!ctrl.signal.aborted) setCandidates([]);
    });
    return () => ctrl.abort();
  }, [api, q]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.shares(dashboardId, ctrl.signal).then(setShares, () => {
      if (!ctrl.signal.aborted) setShares([]);
    });
    return () => ctrl.abort();
  }, [api, dashboardId]);

  const shared = new Set(shares?.map((s) => s.userId));
  const updateShares = (next: DashboardShare[]) => {
    setShares(next);
    onSharesChanged(next.length);
  };

  const share = async () => {
    setPending(true);
    setError(null);
    try {
      updateShares(await api.addShares(dashboardId, [...picked], access));
      setPicked(new Set());
    } catch (err) {
      setError(
        err instanceof ApiError &&
          (err.code === 'share_limit' || err.status === 422 || err.status === 409)
          ? LIMIT_TEXT
          : "Couldn't share. Try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const changeAccess = async (s: DashboardShare, next: ShareAccess) => {
    if (next === s.access) return;
    try {
      updateShares(await api.setShareAccess(dashboardId, s.userId, next));
      toast(next === 'edit' ? `${s.name} can now edit` : `${s.name} can now only view`);
    } catch {
      toast.error("Couldn't change access. Try again.");
    }
  };

  const revoke = async (s: DashboardShare) => {
    try {
      await api.revokeShare(dashboardId, s.userId);
      updateShares((shares ?? []).filter((x) => x.userId !== s.userId));
      toast(`${s.name} no longer has access`);
    } catch {
      toast.error("Couldn't revoke access. Try again.");
    }
  };

  return (
    <div className="space-y-4" data-testid="share-dialog">
      <div>
        <label htmlFor="share-search" className="mb-1.5 block text-xs font-bold text-text-muted">
          Add people
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            id="share-search"
            type="search"
            value={text}
            placeholder="Search name or email"
            onChange={(e) => setText(e.target.value)}
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </div>
        <ul
          aria-label="People"
          className="mt-2 max-h-48 overflow-y-auto rounded-tile border border-tile-border"
          data-testid="share-candidates"
        >
          {candidates === null ? (
            <li className="p-3 text-xs text-text-muted">Loading…</li>
          ) : candidates.length === 0 ? (
            <li className="p-3 text-xs text-text-muted">No people found</li>
          ) : (
            candidates.map((c) => {
              const already = shared.has(c.userId);
              return (
                <li key={c.userId}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-tile has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
                    <input
                      type="checkbox"
                      checked={already || picked.has(c.userId)}
                      disabled={already}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(c.userId);
                        else next.delete(c.userId);
                        setPicked(next);
                      }}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-text-muted">{c.email}</span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger" data-testid="share-error">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <select
            aria-label="Access for new people"
            data-testid="share-access"
            value={access}
            onChange={(e) => setAccess(e.target.value as ShareAccess)}
            className={selectClass}
          >
            <option value="view">{ACCESS_LABEL.view}</option>
            <option value="edit">{ACCESS_LABEL.edit}</option>
          </select>
          <Button onClick={share} disabled={!picked.size || pending || picked.size > 20}>
            Share{picked.size ? ` (${picked.size})` : ''}
          </Button>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-bold text-text-muted">People with access</h3>
        <ul className="divide-y divide-glass-border/60" data-testid="share-people">
          <li className="flex h-10 items-center text-sm">You (owner)</li>
          {shares?.map((s) => (
            <li
              key={s.userId}
              className="flex min-h-12 items-center gap-3 py-1.5"
              data-testid="share-person"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                <span className="block truncate text-xs text-text-muted">
                  {s.email} · Shared {formatUpdated(s.sharedAt, now)}
                </span>
              </span>
              <select
                aria-label={`Access for ${s.name}`}
                data-testid="share-person-access"
                value={s.access}
                onChange={(e) => void changeAccess(s, e.target.value as ShareAccess)}
                className={selectClass}
              >
                <option value="view">View</option>
                <option value="edit">Edit</option>
              </select>
              <Button variant="outline" size="sm" onClick={() => void revoke(s)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
