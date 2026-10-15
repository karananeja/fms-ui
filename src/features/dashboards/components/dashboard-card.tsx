import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Clock,
  Copy,
  EllipsisVertical,
  ExternalLink,
  PencilLine,
  Share2,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { DashboardSummary } from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';
import { useTheme } from '@/shared/theme/use-theme';
import type { DashboardsApi } from '../api/dashboards-api';
import { useDashboardPeek, type DashboardPeek } from '../lib/dashboard-peek';
import { formatUpdated, widgetCountText } from '../lib/format';
import { snapshotAgeText } from '../lib/snapshot-rules';
import { widgetTypeInfo } from '../lib/widget-meta';

const menuItem =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none data-[highlighted]:bg-tile data-[highlighted]:text-accent [&_svg]:size-4';

export type CardAction = 'open' | 'rename' | 'duplicate' | 'share' | 'delete';
export type ListView = 'grid' | 'list';

/** Thumbnail tile colour per widget type (theme tokens only). */
const TYPE_FILL: Record<string, string> = {
  kpi: 'var(--accent)',
  'daily-chart': 'var(--accent-2)',
  'status-breakdown': 'var(--st-running)',
  ranking: 'var(--st-charging)',
  'vehicle-list': 'var(--st-pullout)',
  'driver-list': 'var(--st-immobilized)',
  'requests-summary': 'var(--warn)',
  text: 'var(--text-faint)',
};

/**
 * F23: a mini layout of the dashboard (12 columns). Until the peek arrives (or when it can't be
 * read) a neutral sketch with `count` tiles stands in.
 */
function Thumbnail({
  peek,
  count,
  className,
}: {
  peek: DashboardPeek | null | undefined;
  count: number;
  className?: string;
}) {
  const items =
    peek?.items ??
    Array.from({ length: Math.min(count, 6) }, (_, k) => ({
      x: (k % 3) * 4,
      y: Math.floor(k / 3) * 3,
      w: 4,
      h: 3,
      type: '',
    }));
  const rows = Math.max(6, ...items.map((it) => it.y + it.h));
  return (
    <svg
      aria-hidden
      data-testid="card-thumbnail"
      data-state={peek ? 'layout' : 'sketch'}
      viewBox={`0 0 120 ${rows * 10}`}
      preserveAspectRatio="xMidYMin meet"
      className={cn('rounded-md bg-tile', className)}
    >
      {items.map((it, k) => (
        <rect
          key={k}
          x={it.x * 10 + 1.5}
          y={it.y * 10 + 1.5}
          width={Math.max(1, it.w * 10 - 3)}
          height={Math.max(1, it.h * 10 - 3)}
          rx="2.5"
          style={{
            fill: TYPE_FILL[it.type] ?? 'var(--tile-border)',
            fillOpacity: it.type ? 0.28 : 1,
          }}
        />
      ))}
      {count === 0 && (
        <rect
          x="4"
          y="4"
          width="112"
          height={rows * 10 - 8}
          rx="4"
          fill="none"
          strokeDasharray="4 3"
          style={{ stroke: 'var(--tile-border)' }}
        />
      )}
    </svg>
  );
}

/**
 * D-142: this viewer's snapshot over a blurred layout drawing (blur-up), with its age and a hover
 * zoom; faded when taken in the other theme. Without one (or if it fails to load) the layout
 * drawing alone, as in F23.
 */
function Preview({
  d,
  peek,
  now,
  compact,
  className,
}: {
  d: DashboardSummary;
  peek: DashboardPeek | null | undefined;
  now: number;
  compact: boolean;
  className: string;
}) {
  const { resolved } = useTheme();
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const snap = d.snapshot && failed !== d.snapshot.url ? d.snapshot : null;
  if (!snap) return <Thumbnail peek={peek} count={d.widgetCount} className={className} />;
  const loaded = loadedUrl === snap.url;
  const otherTheme = snap.theme !== resolved;
  const age = `Snapshot · ${snapshotAgeText(snap.capturedAt, now)}${otherTheme ? ' (other theme)' : ''}`;
  return (
    <div
      data-testid="card-snapshot"
      data-theme-match={otherTheme ? 'false' : 'true'}
      title={age}
      className={cn('relative overflow-hidden rounded-md bg-tile', className)}
    >
      <Thumbnail
        peek={peek}
        count={d.widgetCount}
        className={cn(
          'absolute inset-0 size-full scale-110 blur-sm transition-opacity duration-300',
          loaded && 'opacity-0',
        )}
      />
      <img
        key={snap.url}
        src={snap.url}
        alt=""
        loading="lazy"
        decoding="async"
        data-testid="card-snapshot-img"
        onLoad={() => setLoadedUrl(snap.url)}
        onError={() => setFailed(snap.url)}
        className={cn(
          'absolute inset-0 size-full object-cover object-top transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.04] group-focus-visible:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100',
          loaded ? (otherTheme ? 'opacity-55' : 'opacity-100') : 'opacity-0',
        )}
      />
      {!compact && (
        <span
          data-testid="card-snapshot-age"
          className="absolute bottom-1.5 left-1.5 rounded-full border border-glass-border bg-surface-solid/90 px-2 py-0.5 text-[10px] font-medium text-text-muted shadow-panel backdrop-blur-sm"
        >
          {age}
        </span>
      )}
    </div>
  );
}

function TypeIcons({ types }: { types: readonly string[] }) {
  if (!types.length) return null;
  return (
    <ul aria-label="Widget types" data-testid="card-types" className="flex items-center gap-1">
      {types.slice(0, 6).map((t) => {
        const { icon: Icon, name } = widgetTypeInfo(t);
        return (
          <li
            key={t}
            title={name}
            className="grid size-6 place-items-center rounded-md bg-tile text-text-muted"
          >
            <Icon aria-hidden className="size-3.5" />
            <span className="sr-only">{name}</span>
          </li>
        );
      })}
      {types.length > 6 && <li className="text-[11px] text-text-faint">+{types.length - 6}</li>}
    </ul>
  );
}

/**
 * §3 / F23: a dashboard card (grid) or row (list). The whole card links to the dashboard (one
 * link); the kebab menu sits outside it. Shows a layout thumbnail, widget-type icons, owner or
 * "Shared by", last update and share count.
 */
export function DashboardCard({
  d,
  now,
  onAction,
  api,
  view = 'grid',
}: {
  d: DashboardSummary;
  now: number;
  onAction(action: CardAction, d: DashboardSummary): void;
  /** Reads the layout for the thumbnail; omitted = sketch only. */
  api?: Pick<DashboardsApi, 'get'>;
  view?: ListView;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const peek = useDashboardPeek(api, d, ref);
  const owner = d.access === 'owner';
  const badge = owner ? d.shareCount > 0 && `Shared · ${d.shareCount}` : `Shared by ${d.ownerName}`;
  const badgeEl = (badge || !owner) && (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {badge && (
        <span
          data-testid="card-badge"
          className={cn(
            'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            owner ? 'bg-accent-soft text-accent' : 'bg-tile text-text-muted',
          )}
        >
          <Users aria-hidden className="size-3" />
          {badge}
        </span>
      )}
      {/* F27: the caller's level on a dashboard shared with them. */}
      {!owner && (
        <span
          data-testid="card-access"
          className={cn(
            'inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold',
            d.access === 'editor' ? 'bg-accent-soft text-accent' : 'bg-tile text-text-muted',
          )}
        >
          {d.access === 'editor' ? 'Can edit' : 'View only'}
        </span>
      )}
    </span>
  );
  const meta = (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
      <span data-testid="card-widgets">{widgetCountText(d.widgetCount)}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1" data-testid="card-updated">
        <Clock aria-hidden className="size-3" />
        {formatUpdated(d.updatedAt, now)}
      </span>
      {owner && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <UserRound aria-hidden className="size-3" />
            You
          </span>
        </>
      )}
    </p>
  );

  return (
    <li
      ref={ref}
      className="relative"
      data-testid="dashboard-card"
      data-dashboard-id={d.id}
      data-view={view}
    >
      <Link
        to="/dashboards/$id"
        params={{ id: d.id }}
        className={cn(
          'group flex h-full rounded-[var(--radius-panel)] shadow-panel glass outline-none transition-colors hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-ring',
          view === 'grid' ? 'min-h-32 flex-col gap-2 p-4' : 'items-center gap-3 p-3 pr-12',
        )}
      >
        {view === 'grid' ? (
          <>
            <Preview d={d} peek={peek} now={now} compact={false} className="h-28 w-full" />
            <h3
              className="line-clamp-2 pr-8 text-base font-semibold break-words group-hover:text-accent"
              data-testid="card-title"
            >
              {d.title}
            </h3>
            {meta}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
              <TypeIcons types={peek?.types ?? []} />
              {badgeEl}
            </div>
          </>
        ) : (
          <>
            <Preview d={d} peek={peek} now={now} compact className="h-10 w-16 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-sm font-semibold group-hover:text-accent"
                data-testid="card-title"
              >
                {d.title}
              </h3>
              {meta}
            </div>
            <div className="hidden md:block">
              <TypeIcons types={peek?.types ?? []} />
            </div>
            {badgeEl}
          </>
        )}
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Actions for ${d.title}`}
          data-testid="card-menu"
          className={cn(
            'absolute right-3 grid size-8 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-tile',
            view === 'grid' ? 'top-[8.5rem]' : 'top-1/2 -translate-y-1/2',
          )}
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
            {(owner || d.access === 'editor') && (
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

export function DashboardCardSkeleton({ view = 'grid' }: { view?: ListView }) {
  return (
    <li
      aria-hidden
      data-testid="dashboard-card-skeleton"
      className={cn(
        'flex gap-2 rounded-[var(--radius-panel)] border border-tile-border p-4',
        view === 'grid' ? 'h-60 flex-col' : 'h-16 items-center p-3',
      )}
    >
      <span
        className={cn(
          'animate-pulse rounded-md bg-tile motion-reduce:animate-none',
          view === 'grid' ? 'h-28 w-full' : 'h-10 w-16',
        )}
      />
      <span className="h-4 w-1/2 animate-pulse rounded-md bg-tile motion-reduce:animate-none" />
      <span className="h-3 w-1/3 animate-pulse rounded-md bg-tile motion-reduce:animate-none" />
    </li>
  );
}
