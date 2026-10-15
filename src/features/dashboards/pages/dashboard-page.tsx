import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { Dashboard, Widget, WidgetPreview } from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import { dashboardEvents } from '@/features/assistant/dashboard-events';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { ApiError } from '@/shared/api/api-client';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useNow } from '@/shared/hooks/use-now';
import { Button } from '@/shared/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import { dashboardsApi, type DashboardsApi } from '../api/dashboards-api';
import { ChatDock } from '../components/chat-dock';
import { DashboardGrid } from '../components/dashboard-grid';
import { DashboardTitleBar, TitleBarSkeleton } from '../components/dashboard-title-bar';
import { DeleteDialog } from '../components/delete-dialog';
import { ShareDialog } from '../components/share-dialog';
import { QueryCache } from '../data/query-cache';
import { QueryCacheContext, useAutoRefresh } from '../data/use-widget-data';
import { widgetRequest } from '../data/widget-queries';
import { LiveWidgetSource } from '../live/live-widget-source';
import { LiveWidgetSourceContext } from '../live/use-live-widget';
import { droppedPreview, draggedPreview } from '../lib/preview-drag';
import { DashboardSession, type AddAt } from '../store/dashboard-session';

const DOCK_KEY = 'fms.dashboards.chat';
const CONFLICT_TEXT = 'This dashboard was changed elsewhere. Showing the latest version.';

function readDock(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== 'closed';
  } catch {
    return true;
  }
}
function writeDock(open: boolean): void {
  try {
    localStorage.setItem(DOCK_KEY, open ? 'open' : 'closed');
  } catch {
    // storage unavailable: keep the in-memory state only
  }
}

/** `/dashboards/$id` (§4): one keyed view per dashboard id. */
export function DashboardPage({ api = dashboardsApi }: { api?: DashboardsApi }) {
  const { id } = useParams({ from: '/app/dashboards/$id' });
  return <DashboardView key={id} id={id} api={api} />;
}

function DashboardView({ id, api }: { id: string; api: DashboardsApi }) {
  const [session] = useState(() => new DashboardSession(id, api));
  const [cache] = useState(() => new QueryCache());
  const [live] = useState(() => new LiveWidgetSource(liveTrackingStore));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { ask } = useSearch({ from: '/app/dashboards/$id' });
  const navigate = useNavigate();
  const canChat = useCan('chat.use');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const compact = !useMediaQuery('(min-width: 640px)');
  const now = useNow(30_000);
  const [dockOpen, setDockOpen] = useState(readDock);
  const [sheetOpen, setSheetOpen] = useState(!!ask);
  const [dialog, setDialog] = useState<'share' | 'delete' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useAutoRefresh(cache);

  useEffect(() => {
    void session.load();
    const onHidden = () => {
      if (document.hidden) session.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      session.dispose();
      cache.dispose();
      live.dispose();
    };
  }, [session, cache, live]);

  // §5: the browser prompt only while saving has failed.
  useEffect(() => {
    if (state.saveState !== 'error' && state.saveState !== 'offline') return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [state.saveState]);

  const notice = useRef(0);
  useEffect(() => {
    if (state.noticeVersion > notice.current) toast(CONFLICT_TEXT);
    notice.current = state.noticeVersion;
  }, [state.noticeVersion]);

  const d = state.dashboard;
  const owner = d?.access === 'owner';
  const showChat = owner && canChat;

  const refreshAll = () => {
    cache.refresh();
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };
  const removeWidget = (wid: string) => {
    const undo = session.removeWidget(wid);
    toast('Widget removed', { duration: 5000, action: { label: 'Undo', onClick: undo } });
  };
  const refreshWidget = (w: Widget) => {
    const key = widgetRequest(w)?.key;
    if (key) cache.refresh(key);
  };
  const duplicate = async () => {
    try {
      const copy = await api.duplicate(id);
      dashboardEvents.emit({ kind: 'created', dashboardId: copy.id });
      await navigate({ to: '/dashboards/$id', params: { id: copy.id } });
    } catch {
      toast.error("Couldn't duplicate.");
    }
  };
  const remove = async () => {
    await api.remove(id);
    setDialog(null);
    toast(`Deleted '${d?.title ?? 'dashboard'}'`);
    await navigate({ to: '/dashboards' });
  };
  // D-135: a chat preview added (button or grid drop) → owner save, then the card state.
  const previewStatusRef = useRef<
    ((pid: string, status: 'added' | 'discarded') => Promise<void>) | null
  >(null);
  const addPreview = async (p: WidgetPreview, at: AddAt | null = null) => {
    try {
      await session.addWidget(p.widget, at);
    } catch (err) {
      const limit = err instanceof ApiError && err.code === 'dashboard_limit';
      toast.error(
        limit
          ? err.message
          : err instanceof ApiError && err.code === 'widget_not_permitted'
            ? "You don't have access to this widget's data"
            : "Couldn't add the widget.",
      );
      throw err;
    }
    await previewStatusRef.current?.(p.id, 'added');
  };
  const adopt = useCallback((next: Dashboard) => session.adoptRemote(next), [session]);
  const consumeAsk = useCallback(
    () => void navigate({ to: '/dashboards/$id', params: { id }, search: {}, replace: true }),
    [navigate, id],
  );
  const toggleDock = () => {
    if (desktop) {
      writeDock(!dockOpen);
      setDockOpen(!dockOpen);
    } else setSheetOpen(!sheetOpen);
  };

  if (state.status === 'not-found')
    return (
      <div
        className="flex flex-col items-center gap-3 px-4 py-16 text-center"
        data-testid="dashboard-not-found"
      >
        <p className="text-sm text-text-muted">
          This dashboard doesn't exist or is no longer shared with you
        </p>
        <Button asChild variant="outline">
          <Link to="/dashboards">Back to dashboards</Link>
        </Button>
      </div>
    );
  if (state.status === 'error' && !d)
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-muted" role="alert">
        Couldn't load this dashboard.
        <Button variant="outline" onClick={() => void session.load()}>
          Retry
        </Button>
      </div>
    );

  const dock = showChat && d && (
    <ChatDock
      dashboardId={id}
      version={() => session.version}
      ask={ask}
      onAskConsumed={consumeAsk}
      onDashboardChanged={adopt}
      onCollapse={desktop ? toggleDock : undefined}
      onAddPreview={(p) => addPreview(p)}
      previewStatusRef={previewStatusRef}
      draggablePreviews={desktop}
    />
  );

  return (
    <QueryCacheContext value={cache}>
      <LiveWidgetSourceContext value={live}>
        <div className="flex h-full min-h-0">
          <div className="flex min-w-0 flex-1 flex-col">
            {d ? (
              <DashboardTitleBar
                dashboard={d}
                owner={owner}
                saveState={state.saveState}
                now={now}
                compact={compact}
                refreshing={refreshing}
                chat={
                  showChat
                    ? { open: desktop ? dockOpen : sheetOpen, onToggle: toggleDock, desktop }
                    : null
                }
                onRename={(t) => session.setTitle(t)}
                onRetry={() => session.retry()}
                onRefresh={refreshAll}
                onShare={() => setDialog('share')}
                onDuplicate={() => void duplicate()}
                onDelete={() => setDialog('delete')}
              />
            ) : (
              <TitleBarSkeleton />
            )}
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
              {!d ? (
                <div className="grid gap-3 sm:grid-cols-3" aria-busy>
                  {[0, 1, 2].map((k) => (
                    <div
                      key={k}
                      className="h-40 animate-pulse rounded-tile bg-tile motion-reduce:animate-none"
                    />
                  ))}
                </div>
              ) : d.widgets.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-3 rounded-tile py-16 text-center"
                  data-testid="dashboard-empty"
                  // D-135: a preview dropped on an empty dashboard lands top-left.
                  onDragOver={(e) => {
                    if (!owner || !draggedPreview(e.dataTransfer)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    const p = owner ? droppedPreview(e.dataTransfer) : null;
                    if (!p) return;
                    e.preventDefault();
                    void addPreview(p).catch(() => {});
                  }}
                >
                  {showChat ? (
                    <>
                      <p className="text-sm text-text-muted">Ask FMS to add widgets</p>
                      <Button
                        onClick={() => {
                          if (desktop) {
                            if (!dockOpen) toggleDock();
                            setTimeout(
                              () =>
                                document
                                  .querySelector<HTMLTextAreaElement>(
                                    '[data-testid="chat-dock"] textarea',
                                  )
                                  ?.focus(),
                              0,
                            );
                          } else setSheetOpen(true);
                        }}
                      >
                        <MessageSquare aria-hidden />
                        Ask FMS
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">This dashboard has no widgets yet</p>
                  )}
                </div>
              ) : (
                <DashboardGrid
                  dashboard={d}
                  owner={owner}
                  onLayout={(l) => session.scheduleLayout(l)}
                  onWidgetRefresh={refreshWidget}
                  onWidgetRename={(wid, t) => session.setWidgetTitle(wid, t)}
                  onWidgetRemove={removeWidget}
                  onDropPreview={(p, at) => void addPreview(p, at).catch(() => {})}
                />
              )}
            </div>
          </div>
          {dock && desktop && dockOpen && (
            <aside className="flex w-[360px] shrink-0 flex-col border-l border-glass-border bg-surface-solid shadow-panel">
              {dock}
            </aside>
          )}
          {dock && desktop && !dockOpen && (
            <aside className="flex w-11 shrink-0 flex-col items-center border-l border-glass-border bg-surface-solid py-3">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ask FMS"
                onClick={toggleDock}
                data-testid="dock-rail"
              >
                <MessageSquare />
              </Button>
            </aside>
          )}
          {dock && !desktop && (
            <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
              <DrawerContent className="h-[85dvh]">
                <DrawerTitle className="sr-only">Ask FMS</DrawerTitle>
                <DrawerDescription className="sr-only">
                  Chat with the assistant about this dashboard
                </DrawerDescription>
                {dock}
              </DrawerContent>
            </Drawer>
          )}
        </div>
        {d && owner && (
          <>
            {dialog === 'share' && (
              <ShareDialog
                open
                onOpenChange={(o) => !o && setDialog(null)}
                dashboardId={id}
                title={d.title}
                api={api}
                onSharesChanged={() => {}}
              />
            )}
            <DeleteDialog
              open={dialog === 'delete'}
              onOpenChange={(o) => !o && setDialog(null)}
              title={d.title}
              onConfirm={remove}
            />
          </>
        )}
      </LiveWidgetSourceContext>
    </QueryCacheContext>
  );
}
