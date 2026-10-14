import { useMemo, useState, type UIEvent } from 'react';
import { CheckCheck } from 'lucide-react';
import type { Notification } from '@shared/contract/index.ts';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { useNotifications, useNotificationStore } from '../use-notifications.ts';
import { NotificationItem } from './notification-item.tsx';

type Tab = 'all' | 'unread';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
];
/** Rows rendered per step: a 1,500-alert burst never renders all at once (no long task). */
const STEP = 50;
const NEAR_END_PX = 160;

/**
 * F15-R2: the notification centre (lazy chunk). Tabs All · Unread, "Mark all read", newest
 * first, infinite scroll: more rows are revealed from memory first, then older pages fetched on
 * the cursor.
 */
export function NotificationPanel({ onOpenItem }: { onOpenItem(n: Notification): void }) {
  const store = useNotificationStore();
  const state = useNotifications((s) => s);
  const [tab, setTab] = useState<Tab>('all');
  const [limit, setLimit] = useState(STEP);
  useNow(30_000);
  const now = store.now();

  const rows = useMemo(
    () => (tab === 'unread' ? state.items.filter((n) => n.readAt === null) : state.items),
    [tab, state.items],
  );
  const shown = rows.slice(0, limit);
  const canGrow = rows.length > limit || state.nextCursor !== null;

  const grow = () => {
    if (rows.length > limit) setLimit((l) => l + STEP);
    else void store.loadMore().then(() => setLimit((l) => l + STEP));
  };
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (canGrow && !state.loadingMore && el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END_PX)
      grow();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="notification-panel">
      <div className="flex items-center gap-2 border-b border-glass-border px-4 pt-3.5 pb-2 pr-12 sm:pr-4">
        <h2 className="text-xs font-extrabold tracking-[0.12em] text-text uppercase">
          Notifications
        </h2>
        <button
          type="button"
          onClick={() => void store.markAllRead()}
          disabled={state.unreadCount === 0}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring disabled:text-text-faint disabled:hover:bg-transparent"
        >
          <CheckCheck className="size-3.5" aria-hidden />
          Mark all read
        </button>
      </div>
      <div role="tablist" aria-label="Filter notifications" className="flex gap-1 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setLimit(STEP);
            }}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.id ? 'bg-accent-soft text-accent' : 'text-text-muted hover:bg-tile',
            )}
          >
            {t.label}
            {t.id === 'unread' && state.unreadCount > 0 && (
              <span className="ml-1.5 tabular-nums">{state.unreadCount}</span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={tab === 'all' ? 'All notifications' : 'Unread notifications'}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto border-t border-glass-border"
      >
        {state.status === 'error' && !shown.length ? (
          <div className="flex flex-col items-center gap-2 p-6 text-sm text-text-muted">
            <p>Couldn&apos;t load notifications.</p>
            <button
              type="button"
              onClick={() => void store.reload()}
              className="rounded-md px-3 py-1 font-bold text-accent hover:bg-tile"
            >
              Try again
            </button>
          </div>
        ) : !shown.length ? (
          <p className="p-6 text-center text-sm text-text-muted">
            {state.status === 'loading' || (state.status === 'idle' && !state.items.length)
              ? 'Loading notifications…'
              : tab === 'unread'
                ? "You're all caught up."
                : 'No notifications yet.'}
          </p>
        ) : (
          <ul aria-label="Notifications list">
            {shown.map((n) => (
              <NotificationItem key={n.id} n={n} now={now} onOpen={onOpenItem} />
            ))}
          </ul>
        )}
        {canGrow && shown.length > 0 && (
          <button
            type="button"
            onClick={grow}
            disabled={state.loadingMore}
            className="w-full py-3 text-xs font-bold text-text-muted hover:bg-tile hover:text-text"
          >
            {state.loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
