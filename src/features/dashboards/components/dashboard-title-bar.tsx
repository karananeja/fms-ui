import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Copy,
  EllipsisVertical,
  History,
  Loader2,
  MessageSquare,
  RotateCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import {
  DASHBOARD_TITLE_MAX,
  type Dashboard,
  type DashboardActivity,
  type DashboardActivityItem,
} from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { formatUpdated } from '../lib/format';
import { lastListSearch } from '../lib/list-search';
import type { SaveState } from '../store/dashboard-session';

const menuItem =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none data-[highlighted]:bg-tile data-[highlighted]:text-accent [&_svg]:size-4';

export interface ChatToggle {
  /** Desktop: the dock is open; mobile: the sheet is open. */
  open: boolean;
  onToggle(): void;
  /** Desktop shows a collapse button; mobile an "Ask FMS" button. */
  desktop: boolean;
}

/**
 * §4.2: inline title, save status, Refresh / Share / Duplicate / Delete / chat toggle. F27:
 * `canEdit` (owner or editor) renames and shows the save state; `owner` alone shares and
 * deletes; "Edited by …" when someone else made the last change; an Activity list.
 */
export function DashboardTitleBar({
  dashboard: d,
  owner,
  canEdit = owner,
  meId = null,
  loadActivity,
  activityActions,
  saveState,
  now,
  compact,
  refreshing,
  chat,
  onRename,
  onRetry,
  onRefresh,
  onShare,
  onDuplicate,
  onDelete,
}: {
  dashboard: Dashboard;
  owner: boolean;
  /** F27: owner or editor (defaults to `owner`). */
  canEdit?: boolean;
  /** F27: the signed-in user (to tell "Edited by <someone else>"). */
  meId?: string | null;
  /** F27: the Activity list; omitted = no Activity button. */
  loadActivity?: () => Promise<DashboardActivity>;
  /** D-161: Undo / Restore / Show / Open chat on entries (owner or editor). */
  activityActions?: ActivityActions;
  saveState: SaveState;
  now: number;
  /** Below 640 px: everything except Refresh moves into "More". */
  compact: boolean;
  refreshing: boolean;
  chat: ChatToggle | null;
  onRename(title: string): void;
  onRetry(): void;
  onRefresh(): void;
  onShare(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.title);

  const save = () => {
    const t = draft.trim().slice(0, DASHBOARD_TITLE_MAX);
    setEditing(false);
    if (t && t !== d.title) onRename(t);
  };

  const other = d.lastEdit && meId && d.lastEdit.userId !== meId ? d.lastEdit : null;
  const status = canEdit ? (
    saveState === 'saving' || saveState === 'pending' ? (
      'Saving…'
    ) : saveState === 'error' ? (
      <>
        Couldn't save ·{' '}
        <button
          type="button"
          onClick={onRetry}
          className="font-semibold text-accent underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </>
    ) : saveState === 'offline' ? (
      'Offline, will retry'
    ) : other ? (
      `Edited by ${other.name} · ${formatUpdated(other.at, now)}`
    ) : (
      `Saved ${formatUpdated(d.updatedAt, now)}`
    )
  ) : other ? (
    `Edited by ${other.name} · ${formatUpdated(other.at, now)}`
  ) : (
    `Updated ${formatUpdated(d.updatedAt, now)}`
  );

  const actions = [
    owner && { id: 'share', label: 'Share', icon: Share2, run: onShare },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, run: onDuplicate },
    owner && { id: 'delete', label: 'Delete', icon: Trash2, run: onDelete, danger: true },
  ].filter(Boolean) as {
    id: string;
    label: string;
    icon: typeof Copy;
    run(): void;
    danger?: boolean;
  }[];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-glass-border px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <BackToList title={d.title} />
        {editing ? (
          <input
            autoFocus
            aria-label="Dashboard title"
            value={draft}
            maxLength={DASHBOARD_TITLE_MAX}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              else if (e.key === 'Escape') {
                setDraft(d.title);
                setEditing(false);
              }
            }}
            className="h-9 w-full max-w-xl rounded-md border border-tile-border bg-tile px-2 font-display text-xl font-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : canEdit ? (
          <h1>
            <button
              type="button"
              title="Rename"
              data-testid="dashboard-title"
              onClick={() => {
                setDraft(d.title);
                setEditing(true);
              }}
              className="max-w-full truncate rounded-md text-left font-display text-xl font-black tracking-wide outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              {d.title}
            </button>
          </h1>
        ) : (
          <h1
            data-testid="dashboard-title"
            className="truncate font-display text-xl font-black tracking-wide"
          >
            {d.title}
          </h1>
        )}
        <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {!owner &&
            (canEdit ? (
              <span
                data-testid="can-edit-badge"
                className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
              >
                Can edit · shared by {d.ownerName}
              </span>
            ) : (
              <span
                data-testid="view-only-badge"
                className="rounded-full bg-tile px-2 py-0.5 text-[11px] font-semibold"
              >
                View only · shared by {d.ownerName}
              </span>
            ))}
          <span
            aria-live="polite"
            data-testid="save-status"
            data-state={canEdit ? saveState : 'viewer'}
          >
            {status}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          title="Refresh"
          onClick={onRefresh}
          data-testid="refresh-dashboard"
        >
          {refreshing ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <RotateCw />
          )}
        </Button>
        {loadActivity && (
          <ActivityButton load={loadActivity} now={now} meId={meId} actions={activityActions} />
        )}
        {!compact &&
          actions.map((a) => (
            <Button
              key={a.id}
              variant="ghost"
              size="sm"
              onClick={a.run}
              data-testid={`action-${a.id}`}
              className={cn(a.danger && 'text-danger hover:text-danger')}
            >
              <a.icon aria-hidden />
              {a.label}
            </Button>
          ))}
        {/* Phones only: on desktop the dock's own header collapses it and its rail reopens it. */}
        {chat && !chat.desktop && (
          <Button
            variant="outline"
            size="sm"
            onClick={chat.onToggle}
            aria-expanded={chat.open}
            data-testid="chat-toggle"
          >
            <MessageSquare aria-hidden />
            Ask FMS
          </Button>
        )}
        {compact && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More" data-testid="more-actions">
                <EllipsisVertical />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 w-44 rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-float"
              >
                {actions.map((a) => (
                  <DropdownMenu.Item
                    key={a.id}
                    className={cn(menuItem, a.danger && 'text-danger')}
                    onSelect={a.run}
                  >
                    <a.icon aria-hidden />
                    {a.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  );
}

/** D-161: what an Activity entry can do (the page performs it). */
export interface ActivityActions {
  /** Undo just this entry. Resolves when done; rejects with a message to show. */
  undo(item: DashboardActivityItem): Promise<void>;
  /** Restore the whole dashboard to before this entry. */
  restore(item: DashboardActivityItem): Promise<void>;
  /** Highlight the widgets the entry touched. */
  show(item: DashboardActivityItem): void;
  /** Open the viewer's own chat turn that made the change. */
  openChat(item: DashboardActivityItem): void;
}

const entryAction =
  'rounded-md px-1.5 py-0.5 text-[11px] font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** F27 (D-152): who changed the dashboard and when (no chat content), read on open. D-161: actionable. */
function ActivityButton({
  load,
  now,
  meId,
  actions,
}: {
  load: () => Promise<DashboardActivity>;
  now: number;
  meId: string | null;
  actions?: ActivityActions;
}) {
  const [items, setItems] = useState<DashboardActivity['items'] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    setFailed(false);
    load().then(
      (a) => setItems(a.items),
      () => setFailed(true),
    );
  };
  const run = async (item: DashboardActivityItem, act: 'undo' | 'restore') => {
    if (!actions) return;
    setBusy(item.id);
    setError(null);
    try {
      await actions[act](item);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't do that.");
    } finally {
      setBusy(null);
      reload();
    }
  };
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) return;
        setConfirming(null);
        setError(null);
        reload();
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Activity"
          title="Activity"
          data-testid="activity-button"
        >
          <History />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-80 rounded-tile border border-glass-border bg-surface-solid p-3 text-text shadow-float"
        >
          <h2 className="mb-2 text-xs font-bold text-text-muted">Activity</h2>
          {error && (
            <p role="alert" className="mb-2 text-xs text-danger" data-testid="activity-error">
              {error}
            </p>
          )}
          <ul className="max-h-80 space-y-2.5 overflow-y-auto" data-testid="activity-list">
            {failed ? (
              <li className="text-xs text-danger">Couldn't load the activity.</li>
            ) : items === null ? (
              <li className="text-xs text-text-muted">Loading…</li>
            ) : items.length === 0 ? (
              <li className="text-xs text-text-muted">No changes yet</li>
            ) : (
              items.map((a, k) => (
                <li
                  key={a.id}
                  className="text-xs"
                  data-testid="activity-item"
                  data-undone={a.undone || undefined}
                >
                  <span className="font-semibold">{a.userId === meId ? 'You' : a.name}</span>{' '}
                  <span className="text-text-muted">
                    · {formatUpdated(a.at, now)}
                    {a.viaChat && ' · via chat'}
                    {a.undone && ' · undone'}
                  </span>
                  <span
                    className={cn('block break-words text-text-muted', a.undone && 'line-through')}
                  >
                    {a.summary}
                  </span>
                  {actions && confirming === a.id ? (
                    <div
                      className="mt-1 rounded-md border border-danger/30 bg-danger/10 p-2"
                      data-testid="activity-confirm"
                    >
                      <p>
                        Restore the dashboard to before this?
                        {k > 0 && ` This also reverts ${k} later change${k === 1 ? '' : 's'}.`}
                      </p>
                      <div className="mt-1.5 flex gap-1">
                        <button
                          type="button"
                          className={entryAction}
                          disabled={busy !== null}
                          onClick={() => void run(a, 'restore')}
                          data-testid="activity-restore-confirm"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className={cn(entryAction, 'text-text-muted')}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    actions && (
                      <div className="mt-0.5 -ml-1.5 flex flex-wrap items-center">
                        {a.undoable && (
                          <button
                            type="button"
                            className={entryAction}
                            disabled={busy !== null}
                            onClick={() => void run(a, 'undo')}
                            data-testid="activity-undo"
                          >
                            {busy === a.id ? 'Undoing…' : 'Undo'}
                          </button>
                        )}
                        {a.restorable && k > 0 && (
                          <button
                            type="button"
                            className={entryAction}
                            disabled={busy !== null}
                            onClick={() => setConfirming(a.id)}
                            data-testid="activity-restore"
                          >
                            Restore to before this
                          </button>
                        )}
                        {a.widgetIds.length > 0 && (
                          <button
                            type="button"
                            className={entryAction}
                            onClick={() => actions.show(a)}
                            data-testid="activity-show"
                          >
                            Show
                          </button>
                        )}
                        {a.changeId && (
                          <button
                            type="button"
                            className={entryAction}
                            onClick={() => actions.openChat(a)}
                            data-testid="activity-open-chat"
                          >
                            Open chat
                          </button>
                        )}
                        {!a.undoable && !a.undone && a.restorable && k > 0 && (
                          <span className="px-1.5 text-[11px] text-text-faint">
                            Undo unavailable: changed later
                          </span>
                        )}
                      </div>
                    )
                  )}
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * F23: "← Dashboards" back to the list with its last tab, search, sort and view; on wide screens
 * it reads as a breadcrumb ("Dashboards / title").
 */
export function BackToList({ title }: { title?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-0.5 flex min-w-0 items-center gap-1 text-xs">
      <Link
        to="/dashboards"
        search={lastListSearch()}
        data-testid="back-to-dashboards"
        className="inline-flex shrink-0 items-center gap-1 rounded-md py-0.5 pr-1 font-semibold text-text-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Dashboards
      </Link>
      {title && (
        <span aria-hidden className="hidden min-w-0 truncate text-text-faint lg:inline">
          / {title}
        </span>
      )}
    </nav>
  );
}

export function TitleBarSkeleton() {
  return (
    <div className="border-b border-glass-border px-5 py-3">
      <BackToList />
      <span
        aria-hidden
        className="mt-1 block h-7 w-64 animate-pulse rounded-md bg-tile motion-reduce:animate-none"
      />
    </div>
  );
}
