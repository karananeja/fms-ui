import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { Notification } from '@shared/contract/index.ts';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';
import { notificationLink } from '../notification-links.ts';
import { NotificationToasts, sonnerToasts, type ToastApi } from '../notification-toasts.ts';
import {
  bellLabel,
  formatBadge,
  useNotifications,
  useNotificationStore,
} from '../use-notifications.ts';

// F15 §3: the panel (list, tabs, items) is its own chunk; the shell carries only the bell.
const loadPanel = () => import('./notification-panel.tsx');
const NotificationPanel = lazy(() => loadPanel().then((m) => ({ default: m.NotificationPanel })));

/**
 * F15-R1/R2/R4: the header bell. Keeps the notification store (and the `events` socket) alive
 * while the shell is shown, shows the unread badge, opens the lazy panel (a 380 px popover on
 * desktop, a full-height sheet on mobile) and raises toasts for live warning/critical arrivals.
 */
export function NotificationBell({
  className,
  toasts = sonnerToasts,
}: {
  className?: string;
  toasts?: ToastApi;
}) {
  const store = useNotificationStore();
  const unread = useNotifications((s) => s.unreadCount);
  const me = useSession(selectMe);
  const navigate = useNavigate();
  const desktop = useMediaQuery('(min-width: 640px)');
  const [open, setOpen] = useState(false);

  useEffect(() => store.retain(), [store]);

  /** Marks read, closes the panel and follows the link (F15-R2). */
  const openItem = (n: Notification) => {
    void store.markRead(n.id);
    setOpen(false);
    const link = notificationLink(n, me);
    if (link) void navigate(link);
  };
  const openItemRef = useRef(openItem);
  useEffect(() => {
    openItemRef.current = openItem;
  });

  useEffect(() => {
    const policy = new NotificationToasts(toasts, (n) =>
      n ? openItemRef.current(n) : setOpen(true),
    );
    return store.onLive((items) => policy.push(items));
  }, [store, toasts]);

  const badge = formatBadge(unread);
  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={bellLabel(unread)}
      data-testid="notification-bell"
      className="relative"
      onPointerEnter={() => void loadPanel()}
      onFocus={() => void loadPanel()}
      onClick={desktop ? undefined : () => setOpen(true)}
    >
      <Bell />
      {badge && (
        <span
          aria-hidden
          data-testid="notification-badge"
          className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] leading-none font-black text-bg"
        >
          {badge}
        </span>
      )}
    </Button>
  );
  const panel = open && (
    <Suspense
      fallback={<p className="p-4 text-sm text-text-muted">Loading notifications…</p>}
    >
      <NotificationPanel onOpenItem={openItem} />
    </Suspense>
  );

  if (!desktop) {
    return (
      <div className={className}>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="right"
            aria-label="Notifications"
            className="w-full gap-0 border-glass-border bg-surface-solid sm:max-w-none"
          >
            <SheetTitle className="sr-only">Notifications</SheetTitle>
            <SheetDescription className="sr-only">Your notifications, newest first</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className={className}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            aria-label="Notifications"
            className="z-50 flex max-h-[min(600px,calc(100vh-80px))] w-[380px] flex-col overflow-hidden rounded-tile border border-glass-border bg-surface-solid text-text shadow-[0_16px_40px_var(--shadow)]"
          >
            {panel}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
