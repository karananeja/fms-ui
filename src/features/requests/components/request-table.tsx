import type { DriverRequest, RequestType } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LifeBuoy, Repeat2, Wrench, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { formatIstShort, formatRelativeTime } from '@/features/access/lib/access-format';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { reasonText, STATUS_META, TYPE_LABEL } from '../lib/request-model';

const ROW_H = 48;

const TYPE_ICON: Record<RequestType, LucideIcon> = {
  breakdown: Wrench,
  replacement: Repeat2,
  rsa: LifeBuoy,
};

const COLS =
  'grid grid-cols-[28px_minmax(110px,1fr)_minmax(96px,auto)_64px] md:grid-cols-[28px_minmax(120px,1fr)_minmax(120px,1fr)_minmax(140px,1.4fr)_130px_72px_90px] items-center gap-3 px-3';

/**
 * F14-R1: the desk table (virtualised, F09/F12 style). Type icon, vehicle (links to the map),
 * driver, reason, status, age and last update; rows updated by a live event flash briefly.
 */
export function RequestTable({
  rows,
  loading,
  highlighted,
  selectedId,
  regnoOf,
  driverNameOf,
  onOpen,
  empty = 'No requests match these filters.',
}: {
  rows: readonly DriverRequest[];
  loading: boolean;
  highlighted: ReadonlySet<string>;
  selectedId: string | null;
  regnoOf: (vehicleId: string) => string | null;
  driverNameOf: (driverId: string) => string | null;
  onOpen: (id: string) => void;
  empty?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual (see fleet-tree)
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    initialRect: { width: 1000, height: 600 },
  });

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-panel)] shadow-[0_30px_80px_rgb(0_0_0/0.35)] glass"
      role="table"
      aria-label="Requests"
      aria-rowcount={rows.length}
      aria-busy={loading || undefined}
    >
      <div
        role="row"
        className={cn(
          COLS,
          'h-10 border-b border-glass-border bg-surface-solid text-[11px] font-black tracking-[0.12em] whitespace-nowrap text-text-muted uppercase',
        )}
      >
        <span role="columnheader">
          <span className="sr-only">Type</span>
        </span>
        <span role="columnheader">Vehicle</span>
        <span role="columnheader" className="hidden md:block">
          Driver
        </span>
        <span role="columnheader" className="hidden md:block">
          Reason
        </span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Age</span>
        <span role="columnheader" className="hidden md:block">
          Updated
        </span>
      </div>
      <div
        ref={scrollRef}
        className="h-[calc(100dvh-300px)] min-h-72 overflow-auto"
        data-testid="requests-scroll"
      >
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((item) => {
            const r = rows[item.index]!;
            const Icon = TYPE_ICON[r.type];
            const meta = STATUS_META[r.status];
            const regno = regnoOf(r.vehicleId);
            const driver = driverNameOf(r.driverId);
            const flash = highlighted.has(r.id);
            return (
              <div
                key={r.id}
                role="row"
                data-row-key={r.id}
                data-highlighted={flash || undefined}
                aria-selected={r.id === selectedId}
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(r.id);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: ROW_H,
                  transform: `translateY(${item.start}px)`,
                }}
                className={cn(
                  COLS,
                  'cursor-pointer border-b border-glass-border/50 text-sm transition-colors duration-700 outline-none hover:bg-tile focus-visible:bg-tile focus-visible:shadow-[inset_2px_0_0_var(--accent)]',
                  r.id === selectedId && 'bg-accent-soft hover:bg-accent-soft',
                  flash && 'bg-warn/15 shadow-[inset_2px_0_0_var(--warn)]',
                )}
              >
                <span role="cell" title={TYPE_LABEL[r.type]}>
                  <Icon aria-label={TYPE_LABEL[r.type]} className="size-4 text-text-muted" />
                </span>
                <span role="cell" className="min-w-0">
                  <Link
                    to="/live-tracking"
                    search={{ vehicle: r.vehicleId }}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-extrabold text-accent hover:underline"
                  >
                    {regno ?? r.vehicleId}
                  </Link>
                  <span className="block truncate text-xs text-text-muted md:hidden">
                    {driver ?? '…'} · {reasonText(r)}
                  </span>
                </span>
                <span role="cell" className="hidden truncate md:block">
                  {driver ?? <span className="text-text-faint">…</span>}
                </span>
                <span role="cell" className="hidden truncate text-text-muted md:block">
                  {reasonText(r)}
                </span>
                <span role="cell">
                  <TintPill color={meta.color} data-status={r.status}>
                    {meta.label}
                  </TintPill>
                </span>
                <span
                  role="cell"
                  className="text-xs text-text-muted tabular-nums"
                  title={formatIstShort(r.createdAt)}
                >
                  {formatRelativeTime(r.createdAt, now).replace(' ago', '')}
                </span>
                <span
                  role="cell"
                  className="hidden text-xs text-text-muted tabular-nums md:block"
                  title={formatIstShort(r.updatedAt)}
                >
                  {formatRelativeTime(r.updatedAt, now)}
                </span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-text-muted">{loading ? 'Loading…' : empty}</p>
        )}
      </div>
    </div>
  );
}
