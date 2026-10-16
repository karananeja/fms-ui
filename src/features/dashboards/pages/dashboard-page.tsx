import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { MessageSquare, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Dashboard, Widget, WidgetPreview } from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import { dashboardEvents } from '@/features/assistant/dashboard-events';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { ApiError } from '@/shared/api/api-client';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/shared/ui/drawer';
import { dashboardsApi, type DashboardsApi } from '../api/dashboards-api';
import { IDLE_DOCK, type DockState } from '@/features/assistant/chat-progress';
import { ChatDock } from '../components/chat-dock';
import { DashboardGrid } from '../components/dashboard-grid';
import { DashboardStarter, TurnFailureCard } from '../components/dashboard-starter';
import {
  DashboardTitleBar,
  TitleBarSkeleton,
  type ActivityActions,
} from '../components/dashboard-title-bar';
import { DeleteDialog } from '../components/delete-dialog';
import { ShareDialog } from '../components/share-dialog';
import { QueryCache } from '../data/query-cache';
import { QueryCacheContext, useAutoRefresh } from '../data/use-widget-data';
import { widgetRequest } from '../data/widget-queries';
import { LiveWidgetSource } from '../live/live-widget-source';
import { LiveWidgetSourceContext } from '../live/use-live-widget';
import { droppedPreview, draggedPreview } from '../lib/preview-drag';
import { useDashboardSnapshot } from '../lib/use-dashboard-snapshot';
import { DashboardSession, type AddAt } from '../store/dashboard-session';
import { dashboardSocket, type DashboardSocket } from '../store/dashboard-socket';

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

/** D-161: scrolls to the first match and outlines every match for a moment. */
function flash(selectors: string[]) {
  const els = selectors.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]);
  els[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  for (const el of els) el.setAttribute('data-activity-highlight', '');
  setTimeout(() => {
    for (const el of els) el.removeAttribute('data-activity-highlight');
  }, 2500);
}

/** F23: shown above the grid while a chat turn builds or changes the dashboard. */
function BuildingBanner() {
  return (
    <div
      role="status"
      data-testid="building-banner"
      className="mb-3 flex items-center gap-2 rounded-tile border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-text"
    >
      <Sparkles
        aria-hidden
        className="size-4 animate-pulse text-accent motion-reduce:animate-none"
      />
      Building your dashboard…
    </div>
  );
}

/** F23: placeholder tiles where the assistant's widgets are about to land. */
function BuildingSkeletons({ count, className }: { count: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('widget-enter grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}
      data-testid="building-skeletons"
    >
      {Array.from({ length: count }, (_, k) => (
        <div
          key={k}
          data-testid="building-skeleton"
          className="flex h-40 flex-col gap-2 rounded-tile border border-dashed border-accent/30 p-3"
        >
          <span className="h-4 w-1/3 animate-pulse rounded-md bg-tile motion-reduce:animate-none" />
          <span className="min-h-0 flex-1 animate-pulse rounded-md bg-tile motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** `/dashboards/$id` (§4): one keyed view per dashboard id. */
export function DashboardPage({
  api = dashboardsApi,
  socket = dashboardSocket,
}: {
  api?: DashboardsApi;
  /** F27: live changes from other people (tests pass a fake or `null`). */
  socket?: Pick<DashboardSocket, 'watch'> | null;
}) {
  const { id } = useParams({ from: '/app/dashboards/$id' });
  return <DashboardView key={id} id={id} api={api} socket={socket} />;
}

function DashboardView({
  id,
  api,
  socket,
}: {
  id: string;
  api: DashboardsApi;
  socket: Pick<DashboardSocket, 'watch'> | null;
}) {
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
  const [activity, setActivity] = useState<DockState>(IDLE_DOCK);
  // F23: a new dashboard (no widgets, empty thread) opens without the dock; the first prompt
  // slides it in. Sticky once true (any widget or message).
  const [docked, setDocked] = useState(false);
  const [slide, setSlide] = useState(false);
  const [announce, setAnnounce] = useState('');
  const meId = useSession(selectMe)?.user.id ?? null;
  // F27 (D-153/D-154): someone else asking the assistant; bumped on others' changes.
  const [busyBy, setBusyBy] = useState<string | null>(null);
  const [syncKey, setSyncKey] = useState(0);
  useAutoRefresh(cache);

  // F27 (D-153): live pushes from other people who have this dashboard open.
  useEffect(() => {
    if (!socket) return;
    return socket.watch(id, (e) => {
      if (e.kind === 'changed') {
        if (e.by.userId === meId && e.version <= session.version) return;
        void session.refresh();
        if (e.by.userId !== meId) setSyncKey((k) => k + 1);
      } else if (e.kind === 'sync') {
        void session.refresh();
        setSyncKey((k) => k + 1);
      } else if (e.kind === 'assistant') {
        setBusyBy(e.running && e.by && e.by.userId !== meId ? e.by.name : null);
      } else if (e.kind === 'access') {
        if (e.access === 'viewer') toast('Your access changed: view only');
        else if (e.access === 'editor') toast('You can now edit this dashboard');
        void session.refresh();
      } else if (e.kind === 'deleted') {
        void session.refresh();
      }
    });
  }, [socket, id, meId, session]);

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
  // F27: editors get the full editing UI (grid, rename, their own chat); owner-only = share/delete.
  const canEdit = owner || d?.access === 'editor';
  const showChat = canEdit && canChat;
  const empty = d?.widgets.length === 0;
  if (showChat && d && !docked && (!empty || activity.messages > 0 || activity.streaming)) {
    setDocked(true);
    // A prompt (typed, chip, template or the `?ask=` hand-off) slides the dock in; a reload of a
    // dashboard that already has a thread shows it at once.
    if (activity.streaming) {
      setSlide(true);
      setAnnounce('Assistant panel opened');
      if (desktop && !dockOpen) {
        writeDock(true);
        setDockOpen(true);
      }
    }
  }
  /** Owners with chat on a new dashboard: the full-width starter, the dock mounted but hidden. */
  const starter = showChat && !!d && !docked;
  // F23: a turn that is changing the dashboard (or filling an empty one) shows the build state.
  const building = showChat && activity.streaming && (activity.changing || empty);

  // D-142: this viewer's list-card snapshot of the grid (grid element only, when idle).
  const scrollRef = useRef<HTMLDivElement>(null);
  useDashboardSnapshot({
    id,
    updatedAt: d?.updatedAt,
    hasWidgets: !!d && d.widgets.length > 0,
    busy: building || activity.streaming || state.saveState !== 'saved',
    rootRef: scrollRef,
  });

  useEffect(() => {
    if (!docked || !slide) return;
    const t = setTimeout(
      () =>
        document.querySelector<HTMLTextAreaElement>('[data-testid="chat-dock"] textarea')?.focus(),
      320,
    );
    return () => clearTimeout(t);
  }, [docked, slide]);

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
    // D-162: bring the new widget into view (it may land in a gap or at the bottom).
    if (!at)
      setTimeout(() => flash([`[data-widget-id="${CSS.escape(p.widget.id ?? '')}"]`]), 150);
    await previewStatusRef.current?.(p.id, 'added');
  };
  const organise = () => {
    const undo = session.organise();
    if (!undo) return toast('Already organised');
    toast('Widgets organised', { duration: 6000, action: { label: 'Undo', onClick: undo } });
  };
  const adopt = useCallback((next: Dashboard) => session.adoptRemote(next), [session]);
  // D-161: Activity entry actions.
  const activityActions: ActivityActions = {
    undo: (item) => runActivity(item.id, 'undo'),
    restore: (item) => runActivity(item.id, 'restore'),
    show: (item) => flash(item.widgetIds.map((w) => `[data-widget-id="${CSS.escape(w)}"]`)),
    openChat: (item) => {
      if (!item.changeId) return;
      if (desktop) {
        if (!dockOpen) toggleDock();
      } else setSheetOpen(true);
      const sel = `[data-testid="chat-dock"] [data-change-id="${CSS.escape(item.changeId)}"]`;
      setTimeout(() => flash([sel]), 350);
    },
  };
  const runActivity = async (activityId: string, action: 'undo' | 'restore') => {
    if (!d) return;
    try {
      adopt(await api.activityAction(id, activityId, action, d.version));
      toast(action === 'undo' ? 'Change undone' : 'Dashboard restored');
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : "Couldn't do that. Try again.", {
        cause: err,
      });
    }
  };
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
  // F23 starter: the prompt goes through the dock (as a one-shot `?ask=`), opened if needed.
  const stopRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const startWith = (prompt: string) => {
    setDocked(true);
    setSlide(true);
    setAnnounce('Assistant panel opened');
    if (desktop && !dockOpen) {
      writeDock(true);
      setDockOpen(true);
    } else if (!desktop) setSheetOpen(true);
    void navigate({
      to: '/dashboards/$id',
      params: { id },
      search: { ask: prompt },
      replace: true,
    });
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
      onActivity={setActivity}
      stopRef={stopRef}
      retryRef={retryRef}
      busyBy={busyBy}
      syncKey={syncKey}
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
                canEdit={canEdit}
                meId={meId}
                loadActivity={() => api.activity(id)}
                activityActions={activityActions}
                saveState={state.saveState}
                now={now}
                compact={compact}
                refreshing={refreshing}
                chat={
                  showChat && docked
                    ? { open: desktop ? dockOpen : sheetOpen, onToggle: toggleDock, desktop }
                    : null
                }
                onRename={(t) => session.setTitle(t)}
                onRetry={() => session.retry()}
                onRefresh={refreshAll}
                onOrganise={canEdit ? organise : undefined}
                onShare={() => setDialog('share')}
                onDuplicate={() => void duplicate()}
                onDelete={() => setDialog('delete')}
              />
            ) : (
              <TitleBarSkeleton />
            )}
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-auto p-4 sm:p-5"
              data-testid="dashboard-scroll"
            >
              {building && <BuildingBanner />}
              {!d || (starter && !activity.ready) ? (
                <div className="grid gap-3 sm:grid-cols-3" aria-busy>
                  {[0, 1, 2].map((k) => (
                    <div
                      key={k}
                      className="h-40 animate-pulse rounded-tile bg-tile motion-reduce:animate-none"
                    />
                  ))}
                </div>
              ) : d.widgets.length === 0 && building ? (
                <BuildingSkeletons count={3} />
              ) : d.widgets.length === 0 ? (
                <div
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-tile text-center',
                    showChat ? 'py-2' : 'py-16',
                  )}
                  data-testid="dashboard-empty"
                  // D-135: a preview dropped on an empty dashboard lands top-left.
                  onDragOver={(e) => {
                    if (!canEdit || !draggedPreview(e.dataTransfer)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    const p = canEdit ? droppedPreview(e.dataTransfer) : null;
                    if (!p) return;
                    e.preventDefault();
                    void addPreview(p).catch(() => {});
                  }}
                >
                  {starter ? (
                    <DashboardStarter
                      streaming={activity.streaming}
                      onSend={startWith}
                      onStop={() => stopRef.current?.()}
                    />
                  ) : showChat ? (
                    // The dock is open: the last turn's failure (if any), then templates and chips.
                    <DashboardStarter
                      compact
                      streaming={activity.streaming}
                      onSend={startWith}
                      onStop={() => stopRef.current?.()}
                      notice={
                        activity.failure ? (
                          <TurnFailureCard
                            failure={activity.failure}
                            onRetry={() => {
                              if (!desktop) setSheetOpen(true);
                              retryRef.current?.();
                            }}
                          />
                        ) : (
                          // Desktop already has the dock (or its rail); the button is the phone's way in.
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-text-muted">
                              Ask FMS in the chat, or pick a template to fill this dashboard.
                            </p>
                            {!desktop && (
                              <Button onClick={() => setSheetOpen(true)}>
                                <MessageSquare aria-hidden />
                                Ask FMS
                              </Button>
                            )}
                          </div>
                        )
                      }
                    />
                  ) : (
                    <p className="text-sm text-text-muted">This dashboard has no widgets yet</p>
                  )}
                </div>
              ) : (
                <>
                  <DashboardGrid
                    dashboard={d}
                    owner={canEdit}
                    onLayout={(l) => session.scheduleLayout(l)}
                    onWidgetRefresh={refreshWidget}
                    onWidgetRename={(wid, t) => session.setWidgetTitle(wid, t)}
                    onWidgetRemove={removeWidget}
                    onDropPreview={(p, at) => void addPreview(p, at).catch(() => {})}
                  />
                  {building && <BuildingSkeletons count={1} className="mt-3" />}
                </>
              )}
            </div>
          </div>
          {/* F23: one aside (one chat instance): hidden while the starter shows, then slid in. */}
          {dock && desktop && (!docked || dockOpen) && (
            <aside
              inert={!docked}
              aria-hidden={!docked || undefined}
              data-testid="dock-panel"
              data-state={docked ? 'open' : 'hidden'}
              className={cn(
                'flex shrink-0 flex-col bg-surface-solid',
                docked
                  ? 'w-[360px] border-l border-glass-border shadow-panel'
                  : 'w-0 overflow-hidden',
                docked && slide && 'dock-slide-in',
              )}
            >
              {dock}
            </aside>
          )}
          {dock && !desktop && !docked && !sheetOpen && <div hidden>{dock}</div>}
          <p role="status" aria-live="polite" className="sr-only" data-testid="dock-announce">
            {announce}
          </p>
          {dock && desktop && docked && !dockOpen && (
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
          {dock && !desktop && (docked || sheetOpen) && (
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
