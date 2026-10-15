import { useMemo } from 'react';
import type { Widget } from '@shared/contract/dashboards.ts';
import { useNavigate } from '@tanstack/react-router';
import { useCan } from '@/features/access/permissions/can';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import {
  cellText,
  COLUMN_BY_ID,
  type TableRow,
} from '@/features/live-tracking/config/table-columns';
import { STATUS_META } from '@/features/live-tracking/config/status-meta';
import type { LiveTrackingState } from '@/features/live-tracking/store/live-tracking-store';
import { useLiveTracking } from '@/features/live-tracking/store/use-live-tracking';
import { cn } from '@/shared/lib/utils';
import { STATE_COPY } from '../components/widget-states';
import { DataBody } from './data-body';
import { useLiveWidgetData } from './widget-data';

type VehicleList = Extract<Widget, { type: 'vehicle-list' }>;

const selectFleets = (s: LiveTrackingState) => s.fleets;

/** §6.3: a sorted, filtered slice of the live fleet (worker query, ≤ 50 rows). */
export function VehicleListWidget({ w }: { w: VehicleList }) {
  const state = useLiveWidgetData(
    w,
    { kind: 'list', filter: w.filter, sort: w.sort, limit: w.limit },
    w.filter.fleetIds ?? [],
  );
  const fleets = useLiveTracking(selectFleets);
  const names = useMemo(() => Object.fromEntries(fleets.map((f) => [f.id, f.name])), [fleets]);
  const navigate = useNavigate();
  const canOpen = useCan('live.view');
  const open = (row: TableRow) =>
    void navigate({ to: '/live-tracking', search: { vehicle: row.vehicleId } });
  return (
    <DataBody
      type="vehicle-list"
      state={state}
      isEmpty={(r) => r.kind !== 'list' || r.rows.length === 0}
      emptyText={STATE_COPY.noVehicles}
    >
      {(r) =>
        r.kind === 'list' && (
          <div className="flex h-full flex-col">
            <div className="widget-no-drag min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs" data-testid="vehicle-list">
                <thead className="sticky top-0 bg-surface-solid">
                  <tr className="h-8 border-b border-glass-border">
                    {w.columns.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={cn(
                          'px-2 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase',
                          COLUMN_BY_ID[c].numeric ? 'text-right' : 'text-left',
                        )}
                      >
                        {COLUMN_BY_ID[c].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr
                      key={row.vehicleId}
                      tabIndex={canOpen ? 0 : undefined}
                      onClick={canOpen ? () => open(row) : undefined}
                      onKeyDown={(e) => {
                        if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          open(row);
                        }
                      }}
                      className="h-7 cursor-pointer border-b border-glass-border/50 outline-none last:border-b-0 hover:bg-tile focus-visible:bg-tile focus-visible:shadow-[inset_2px_0_0_var(--accent)]"
                    >
                      {w.columns.map((c) => (
                        <td
                          key={c}
                          className={cn(
                            'px-2 whitespace-nowrap',
                            COLUMN_BY_ID[c].numeric && 'text-right tabular-nums',
                            c === 'regno' && 'font-semibold',
                          )}
                        >
                          {c === 'status' && row.status ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden
                                className="size-2 rounded-full"
                                style={{ background: STATUS_META[row.status].color }}
                              />
                              {STATUS_META[row.status].label}
                            </span>
                          ) : (
                            cellText(c, row, names)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className="shrink-0 pt-1.5 text-[11px] text-text-faint"
              data-testid="vehicle-list-footer"
            >
              {formatNum(r.rows.length)} of {formatNum(r.total)} vehicles
            </p>
          </div>
        )
      }
    </DataBody>
  );
}
