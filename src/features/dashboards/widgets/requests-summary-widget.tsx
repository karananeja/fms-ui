import { REQUEST_STATUSES, REQUEST_TYPES, type DriverRequest } from '@shared/contract/index.ts';
import type { Widget } from '@shared/contract/dashboards.ts';
import { useNavigate } from '@tanstack/react-router';
import { formatRelative } from '@/features/live-tracking/lib/format-relative';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import {
  isOpenRequest,
  STATUS_META as REQUEST_STATUS,
  TYPE_LABEL,
} from '@/features/requests/lib/request-model';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import { DataBody } from './data-body';
import { useRestWidget } from './widget-data';

type Summary = Extract<Widget, { type: 'requests-summary' }>;
type List = { items: DriverRequest[]; nextCursor: string | null };

const TYPE_COLOR: Record<DriverRequest['type'], string> = {
  breakdown: 'var(--danger)',
  replacement: 'var(--accent)',
  rsa: 'var(--warn)',
};

/** Client-side filter of the fetched page (types, open only). */
export function filterRequests(w: Summary, items: readonly DriverRequest[]): DriverRequest[] {
  return items.filter(
    (r) => (!w.types || w.types.includes(r.type)) && (!w.openOnly || isOpenRequest(r)),
  );
}

/** Counts per status or type, in catalogue order, empty groups dropped. */
export function groupRequests(w: Summary, items: readonly DriverRequest[]) {
  const keys = w.groupBy === 'status' ? REQUEST_STATUSES : REQUEST_TYPES;
  return keys
    .map((k) => ({
      key: k,
      label:
        w.groupBy === 'status'
          ? REQUEST_STATUS[k as DriverRequest['status']].label
          : TYPE_LABEL[k as DriverRequest['type']],
      color:
        w.groupBy === 'status'
          ? REQUEST_STATUS[k as DriverRequest['status']].color
          : TYPE_COLOR[k as DriverRequest['type']],
      count: items.filter((r) => (w.groupBy === 'status' ? r.status : r.type) === k).length,
    }))
    .filter((g) => g.count > 0);
}

export function RequestsSummaryWidget({ w, now }: { w: Summary; now: number }) {
  const state = useRestWidget<List>(w);
  const navigate = useNavigate();
  return (
    <DataBody
      type="requests-summary"
      state={state}
      isEmpty={(d) => filterRequests(w, d.items).length === 0}
      emptyText="No requests match"
    >
      {(d) => {
        const items = filterRequests(w, d.items);
        if (w.display === 'counts') {
          const groups = groupRequests(w, items);
          const max = Math.max(...groups.map((g) => g.count));
          const more = d.nextCursor !== null;
          return (
            <ul
              className="widget-no-drag flex h-full flex-col justify-center gap-2 overflow-auto"
              data-testid="requests-counts"
            >
              {groups.map((g) => (
                <li
                  key={g.key}
                  className="grid grid-cols-[96px_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="truncate text-text-muted">{g.label}</span>
                  <svg
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    aria-hidden
                    className="h-2.5 w-full"
                  >
                    <rect width="100" height="8" rx="2" style={{ fill: 'var(--tile)' }} />
                    <rect
                      width={(g.count / max) * 100}
                      height="8"
                      rx="2"
                      style={{ fill: g.color }}
                    />
                  </svg>
                  <span className="text-right font-semibold tabular-nums">
                    {formatNum(g.count)}
                    {more && '+'}
                  </span>
                </li>
              ))}
              {more && (
                <li className="text-[11px] text-text-faint" data-testid="requests-more">
                  Counted over the newest 500+ requests
                </li>
              )}
            </ul>
          );
        }
        return (
          <div className="widget-no-drag h-full overflow-auto">
            <table className="w-full text-xs" data-testid="requests-latest">
              <thead className="sticky top-0 bg-surface-solid">
                <tr className="h-8 border-b border-glass-border text-left text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                  <th scope="col" className="px-2">
                    Type
                  </th>
                  <th scope="col" className="px-2">
                    Vehicle
                  </th>
                  <th scope="col" className="px-2">
                    Status
                  </th>
                  <th scope="col" className="px-2 text-right">
                    Age
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, w.limit).map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() =>
                      void navigate({ to: '/requests/$requestId', params: { requestId: r.id } })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void navigate({ to: '/requests/$requestId', params: { requestId: r.id } });
                      }
                    }}
                    className="h-8 cursor-pointer border-b border-glass-border/50 outline-none last:border-b-0 hover:bg-tile focus-visible:bg-tile"
                  >
                    <td className="px-2 whitespace-nowrap">{TYPE_LABEL[r.type]}</td>
                    <td className="px-2 font-semibold whitespace-nowrap">{r.vehicleId}</td>
                    <td className="px-2">
                      <TintPill color={REQUEST_STATUS[r.status].color}>
                        {REQUEST_STATUS[r.status].label}
                      </TintPill>
                    </td>
                    <td className="px-2 text-right whitespace-nowrap text-text-muted">
                      {formatRelative(r.createdAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </DataBody>
  );
}
