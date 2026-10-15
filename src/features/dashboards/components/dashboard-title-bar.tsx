import { useState } from 'react';
import {
  Copy,
  EllipsisVertical,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { DASHBOARD_TITLE_MAX, type Dashboard } from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { formatUpdated } from '../lib/format';
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

/** §4.2: inline title, save status, Refresh / Share / Duplicate / Delete / chat toggle. */
export function DashboardTitleBar({
  dashboard: d,
  owner,
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

  const status = owner ? (
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
    ) : (
      `Saved ${formatUpdated(d.updatedAt, now)}`
    )
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
        ) : owner ? (
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
          {!owner && (
            <span
              data-testid="view-only-badge"
              className="rounded-full bg-tile px-2 py-0.5 text-[11px] font-semibold"
            >
              View only · shared by {d.ownerName}
            </span>
          )}
          <span
            aria-live="polite"
            data-testid="save-status"
            data-state={owner ? saveState : 'viewer'}
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
        {chat && (chat.desktop ? !compact : true) && (
          <Button
            variant={chat.desktop ? 'ghost' : 'outline'}
            size="sm"
            onClick={chat.onToggle}
            aria-expanded={chat.open}
            data-testid="chat-toggle"
          >
            {chat.desktop ? (
              chat.open ? (
                <PanelRightClose aria-hidden />
              ) : (
                <PanelRightOpen aria-hidden />
              )
            ) : (
              <MessageSquare aria-hidden />
            )}
            {chat.desktop ? (chat.open ? 'Hide chat' : 'Ask FMS') : 'Ask FMS'}
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

export function TitleBarSkeleton() {
  return (
    <div aria-hidden className="flex items-center gap-3 border-b border-glass-border px-5 py-4">
      <span className="h-7 w-64 animate-pulse rounded-md bg-tile motion-reduce:animate-none" />
    </div>
  );
}
