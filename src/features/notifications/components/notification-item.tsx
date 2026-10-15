import { Bell, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Notification } from '@shared/contract/index.ts';
import { formatRelative } from '@/features/live-tracking/lib/format-relative';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';

const SEVERITY: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  critical: { icon: OctagonAlert, tone: 'text-danger bg-danger/12', label: 'Critical' },
  warning: { icon: TriangleAlert, tone: 'text-warn bg-warn/12', label: 'Warning' },
  info: { icon: Info, tone: 'text-accent-2 bg-accent-2/12', label: 'Info' },
};
const GENERIC = { icon: Bell, tone: 'text-text-muted bg-tile', label: 'Notice' };

/** F15-R5: a short tag per known kind; unknown kinds render generically (never dropped). */
const KIND_LABEL: Record<string, string> = {
  'no-gps-24h': 'No GPS',
  'request-created': 'New request',
  'request-updated': 'Request update',
  'replacement-waiting': 'Replacement',
};

/** F15-R2: severity icon/colour, title, body, relative time (IST on hover), unread dot. */
export function NotificationItem({
  n,
  now,
  onOpen,
}: {
  n: Notification;
  now: number;
  onOpen(n: Notification): void;
}) {
  const sev = SEVERITY[n.severity] ?? GENERIC;
  const Icon = sev.icon;
  const unread = n.readAt === null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        data-testid="notification-item"
        data-kind={n.kind}
        data-unread={unread || undefined}
        className={cn(
          'flex w-full gap-3 border-b border-glass-border px-4 py-3 text-left outline-none hover:bg-tile focus-visible:bg-tile focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          unread && 'bg-accent-soft/40',
        )}
      >
        <span
          className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', sev.tone)}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{sev.label}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 text-sm leading-snug',
                unread ? 'font-semibold text-text' : 'font-bold text-text-muted',
              )}
            >
              {n.title}
            </span>
            {unread && (
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{n.body}</span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-text-faint">
            <span className="font-bold tracking-[0.08em] uppercase">
              {KIND_LABEL[n.kind] ?? 'Notification'}
            </span>
            <span aria-hidden>·</span>
            <time
              dateTime={new Date(n.createdAt).toISOString()}
              title={`${formatIst(n.createdAt)} IST`}
            >
              {formatRelative(n.createdAt, now)}
            </time>
          </span>
        </span>
      </button>
    </li>
  );
}
