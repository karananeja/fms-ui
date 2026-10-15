import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDownUp, LayoutGrid, List, Plus, RotateCcw, Search } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { toast } from 'sonner';
import {
  DASHBOARDS_PER_USER,
  type DashboardList,
  type DashboardSummary,
} from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import { dashboardEvents } from '@/features/assistant/dashboard-events';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { Button } from '@/shared/ui/button';
import { dashboardsApi, type DashboardsApi } from '../api/dashboards-api';
import {
  DashboardCard,
  DashboardCardSkeleton,
  type CardAction,
  type ListView,
} from '../components/dashboard-card';
import { CreateWithAiHero, DashboardsEmptyState } from '../components/dashboards-empty-state';
import {
  arrange,
  LIST_Q_MAX,
  parseListSearch,
  rememberListSearch,
  type ListSearch,
  type ListSort,
} from '../lib/list-search';
import { DeleteDialog } from '../components/delete-dialog';
import { RenameDialog } from '../components/rename-dialog';
import { ShareDialog } from '../components/share-dialog';
import { DashboardListStore } from '../store/dashboard-list-store';

const LIMIT_TEXT = `You have ${DASHBOARDS_PER_USER} dashboards, the maximum`;
const tabClass =
  'h-9 rounded-[10px] px-3 text-xs font-semibold tracking-[0.08em] text-text-muted uppercase outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent-soft data-[state=active]:text-accent';

const grid = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

const touch = (list: DashboardList, id: string, fn: (d: DashboardSummary) => DashboardSummary) => ({
  mine: list.mine.map((d) => (d.id === id ? fn(d) : d)),
  sharedWithMe: list.sharedWithMe.map((d) => (d.id === id ? fn(d) : d)),
});

/** `/dashboards` (§3): My dashboards and Shared with me, with the empty state. */
export function DashboardsPage({ api = dashboardsApi }: { api?: DashboardsApi }) {
  const [store] = useState(() => new DashboardListStore(api));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const search = useSearch({ from: '/app/dashboards' });
  const navigate = useNavigate();
  // F23: list state in the URL (replace, so Back leaves the page) and remembered for "← Dashboards".
  const setSearch = (patch: Partial<ListSearch>) =>
    void navigate({
      to: '/dashboards',
      search: (prev) => parseListSearch({ ...prev, ...patch }),
      replace: true,
    });
  useEffect(() => rememberListSearch(search), [search]);
  const [qText, setQText] = useState(search.q ?? '');
  const canChat = useCan('chat.use');
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'share' | 'delete';
    d: DashboardSummary;
  } | null>(null);

  useEffect(() => {
    void store.load();
    const onFocus = () => store.loadIfStale();
    window.addEventListener('focus', onFocus);
    const off = dashboardEvents.subscribe(() => void store.load());
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, [store]);

  const data = state.data;
  const mine = data?.mine ?? [];
  const shared = data?.sharedWithMe ?? [];
  const atLimit = mine.length >= DASHBOARDS_PER_USER;

  const create = async (ask?: string) => {
    setBusy(true);
    try {
      const d = await api.create();
      await navigate({ to: '/dashboards/$id', params: { id: d.id }, search: ask ? { ask } : {} });
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'dashboard_limit'
          ? LIMIT_TEXT
          : "Couldn't create a dashboard. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (d: DashboardSummary) => {
    try {
      const copy = await api.duplicate(d.id);
      toast('Duplicated', {
        action: {
          label: 'Open',
          onClick: () => void navigate({ to: '/dashboards/$id', params: { id: copy.id } }),
        },
      });
      void store.load();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'dashboard_limit'
          ? LIMIT_TEXT
          : "Couldn't duplicate.",
      );
    }
  };

  const onAction = (action: CardAction, d: DashboardSummary) => {
    if (action === 'open') void navigate({ to: '/dashboards/$id', params: { id: d.id } });
    else if (action === 'duplicate') void duplicate(d);
    else setDialog({ kind: action, d });
  };

  const rename = async (title: string) => {
    const d = dialog!.d;
    try {
      const next = await api.patch(d.id, { version: d.version, title });
      store.patch((l) =>
        touch(l, d.id, (x) => ({
          ...x,
          title: next.title,
          version: next.version,
          updatedAt: next.updatedAt,
        })),
      );
      setDialog(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('Changed elsewhere, try again');
        void store.load();
        setDialog(null);
      } else toast.error("Couldn't rename. Try again.");
    }
  };

  const remove = async () => {
    const d = dialog!.d;
    try {
      await api.remove(d.id);
      store.patch((l) => ({ ...l, mine: l.mine.filter((x) => x.id !== d.id) }));
      setDialog(null);
      toast(`Deleted '${d.title}'`);
    } catch {
      toast.error("Couldn't delete. Try again.");
    }
  };

  const newButton = (
    <span title={atLimit ? LIMIT_TEXT : undefined}>
      <Button
        onClick={() => void create()}
        disabled={atLimit || busy || !data}
        data-testid="new-dashboard"
      >
        <Plus aria-hidden />
        New dashboard
      </Button>
    </span>
  );

  const view: ListView = search.view === 'list' ? 'list' : 'grid';
  const sort: ListSort = search.sort ?? 'recent';
  const q = qText.trim();
  const shownMine = arrange(mine, q, sort);
  const shownShared = arrange(shared, q, sort);
  const listClass = view === 'grid' ? grid : 'flex flex-col gap-2';

  const cards = (list: DashboardSummary[]) =>
    list.length ? (
      <ul className={listClass} data-testid="dashboard-list" data-view={view}>
        {list.map((d) => (
          <DashboardCard key={d.id} d={d} now={now} onAction={onAction} api={api} view={view} />
        ))}
      </ul>
    ) : (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-text-muted">
        <p data-testid="no-matches">No dashboards match “{q}”</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setQText('');
            setSearch({ q: undefined });
          }}
        >
          Clear search
        </Button>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-black tracking-wide">Dashboards</h1>
        <div className="ml-auto">{newButton}</div>
      </header>

      {canChat && data && (mine.length > 0 || shared.length > 0) && (
        <CreateWithAiHero busy={busy} disabled={atLimit} onBuild={(p) => void create(p)} />
      )}

      {state.status === 'error' && !data ? (
        <div
          className="flex flex-col items-center gap-3 py-10 text-sm text-text-muted"
          role="alert"
        >
          Couldn't load dashboards.
          <Button variant="outline" onClick={() => void store.load()}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      ) : !data ? (
        <ul className={listClass} aria-busy data-testid="dashboards-loading">
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <DashboardCardSkeleton key={k} view={view} />
          ))}
        </ul>
      ) : !mine.length && !shared.length ? (
        <DashboardsEmptyState
          fullPage
          canChat={canChat}
          busy={busy}
          onStartBlank={() => void create()}
          onBuild={(p) => void create(p)}
        />
      ) : (
        <Tabs.Root
          value={search.tab === 'shared' ? 'shared' : 'mine'}
          onValueChange={(v) => setSearch({ tab: v === 'shared' ? 'shared' : undefined })}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Tabs.List
              aria-label="Dashboards"
              className="inline-flex gap-1 rounded-tile border border-tile-border bg-tile p-1"
            >
              <Tabs.Trigger value="mine" className={tabClass} data-testid="tab-mine">
                My dashboards ({q ? `${shownMine.length}/${mine.length}` : mine.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="shared" className={tabClass} data-testid="tab-shared">
                Shared with me ({q ? `${shownShared.length}/${shared.length}` : shared.length})
              </Tabs.Trigger>
            </Tabs.List>
            <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <label className="relative min-w-40 flex-1 sm:max-w-64">
                <span className="sr-only">Search dashboards</span>
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-faint"
                />
                <input
                  type="search"
                  data-testid="dashboards-search"
                  value={qText}
                  maxLength={LIST_Q_MAX}
                  placeholder="Search by title, description or owner"
                  onChange={(e) => {
                    setQText(e.target.value);
                    setSearch({ q: e.target.value || undefined });
                  }}
                  className="h-9 w-full rounded-tile border border-tile-border bg-tile pr-2 pl-8 text-sm outline-none placeholder:text-text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-text-muted">
                <ArrowDownUp aria-hidden className="size-3.5" />
                <span className="sr-only">Sort dashboards</span>
                <select
                  data-testid="dashboards-sort"
                  value={sort}
                  onChange={(e) => {
                    const s = e.target.value as ListSort;
                    setSearch({ sort: s === 'recent' ? undefined : s });
                  }}
                  className="h-9 rounded-tile border border-tile-border bg-tile px-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="recent">Recently updated</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="widgets">Most widgets</option>
                </select>
              </label>
              <div
                role="group"
                aria-label="Layout"
                className="inline-flex rounded-tile border border-tile-border bg-tile p-0.5"
              >
                {(
                  [
                    ['grid', LayoutGrid, 'Grid view'],
                    ['list', List, 'List view'],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={view === v}
                    data-testid={`view-${v}`}
                    onClick={() => setSearch({ view: v === 'list' ? 'list' : undefined })}
                    className="grid size-8 place-items-center rounded-[10px] text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent-soft aria-pressed:text-accent"
                  >
                    <Icon aria-hidden className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Tabs.Content value="mine" className="outline-none">
            {mine.length ? (
              cards(shownMine)
            ) : (
              <DashboardsEmptyState
                canChat={canChat}
                busy={busy}
                onStartBlank={() => void create()}
                onBuild={(p) => void create(p)}
              />
            )}
          </Tabs.Content>
          <Tabs.Content value="shared" className="outline-none">
            {shared.length ? (
              cards(shownShared)
            ) : (
              <p className="py-10 text-center text-sm text-text-muted">
                Nothing shared with you yet
              </p>
            )}
          </Tabs.Content>
        </Tabs.Root>
      )}

      <RenameDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.d.title ?? ''}
        onSave={rename}
      />
      <DeleteDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.d.title ?? ''}
        onConfirm={remove}
      />
      {dialog?.kind === 'share' && (
        <ShareDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          dashboardId={dialog.d.id}
          title={dialog.d.title}
          api={api}
          onSharesChanged={(n) =>
            store.patch((l) => touch(l, dialog.d.id, (x) => ({ ...x, shareCount: n })))
          }
        />
      )}
    </div>
  );
}
