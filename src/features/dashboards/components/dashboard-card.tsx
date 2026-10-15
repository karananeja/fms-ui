import { Link } from '@tanstack/react-router';
import {
  Copy,
  EllipsisVertical,
  ExternalLink,
  PencilLine,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { DashboardSummary } from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';
import { formatUpdated, widgetCountText } from '../lib/format';

const menuItem =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none data-[highlighted]:bg-tile data-[highlighted]:text-accent [&_svg]:size-4';

export type CardAction = 'open' | 'rename' | 'duplicate' | 'share' | 'delete';

/** §3: a dashboard card (the whole card links to it); the kebab menu sits outside the link. */
export function DashboardCard({
  d,
  now,
  onAction,
}: {
  d: DashboardSummary;
  now: number;
  onAction(action: CardAction, d: DashboardSummary): void;
}) {
  const owner = d.access === 'owner';
  const badge = owner ? d.shareCount > 0 && `Shared · ${d.shareCount}` : `Shared by ${d.ownerName}`;
  return (
    <li className="relative" data-testid="dashboard-card" data-dashboard-id={d.id}>
      <Link
        to="/dashboards/$id"
        params={{ id: d.id }}
        className="flex h-full min-h-32 flex-col gap-2 rounded-[var(--radius-panel)] p-4 pr-12 shadow-panel glass outline-none hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="line-clamp-2 text-base font-semibold break-words" data-testid="card-title">
          {d.title}
        </h3>
        <p className="text-xs text-text-muted">
          {widgetCountText(d.widgetCount)} · Updated {formatUpdated(d.updatedAt, now)}
        </p>
        {badge && (
          <span
            data-testid="card-badge"
            className={cn(
              'mt-auto inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              owner ? 'bg-accent-soft text-accent' : 'bg-tile text-text-muted',
            )}
          >
            <Users aria-hidden className="size-3" />
            {badge}
          </span>
        )}
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Actions for ${d.title}`}
          data-testid="card-menu"
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-tile"
        >
          <EllipsisVertical aria-hidden className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 w-44 rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-float"
          >
            <DropdownMenu.Item className={menuItem} onSelect={() => onAction('open', d)}>
              <ExternalLink aria-hidden />
              Open
            </DropdownMenu.Item>
            {owner && (
              <DropdownMenu.Item className={menuItem} onSelect={() => onAction('rename', d)}>
                <PencilLine aria-hidden />
                Rename
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={menuItem} onSelect={() => onAction('duplicate', d)}>
              <Copy aria-hidden />
              Duplicate
            </DropdownMenu.Item>
            {owner && (
              <>
                <DropdownMenu.Item className={menuItem} onSelect={() => onAction('share', d)}>
                  <Share2 aria-hidden />
                  Share
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-glass-border" />
                <DropdownMenu.Item
                  className={cn(menuItem, 'text-danger')}
                  onSelect={() => onAction('delete', d)}
                >
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

export function DashboardCardSkeleton() {
  return (
    <li
      aria-hidden
      className="h-32 animate-pulse rounded-[var(--radius-panel)] bg-tile motion-reduce:animate-none"
    />
  );
}
