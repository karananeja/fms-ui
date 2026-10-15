import type { VehicleRanking } from '@shared/contract/index.ts';
import { cn } from '@/shared/lib/utils';
import type { DriverRanking } from '../api/analytics-api';
import { DRIVER_COLS, VEHICLE_COLS, type Col } from '../lib/ranking-columns';
import type { Tab } from '../lib/analytics-model';

export type Entity =
  { kind: 'vehicle'; id: string; label: string } | { kind: 'driver'; id: string; label: string };

/** F16-R2/R3: ranking rows; a row opens the drill-down. Long lists scroll inside the card. */
export function RankingTable({
  tab,
  ranking,
  onOpen,
  tall,
}: {
  tab: Tab;
  ranking: VehicleRanking | DriverRanking;
  onOpen: (e: Entity) => void;
  tall?: boolean;
}) {
  const rows =
    tab === 'vehicles'
      ? (ranking as VehicleRanking).items.map((r) => ({
          key: r.vehicleId,
          cells: VEHICLE_COLS.map((c) => c.cell(r)),
          entity: { kind: 'vehicle', id: r.vehicleId, label: r.regno } as Entity,
        }))
      : (ranking as DriverRanking).items.map((r) => ({
          key: r.driverId,
          cells: DRIVER_COLS.map((c) => c.cell(r)),
          entity: { kind: 'driver', id: r.driverId, label: r.name } as Entity,
        }));
  const cols = (tab === 'vehicles' ? VEHICLE_COLS : DRIVER_COLS) as Col<unknown>[];
  return (
    <div className={cn('overflow-auto', tall && 'max-h-[560px]')}>
      <table className="w-full text-sm" aria-label="Ranking" data-testid="ranking">
        <thead className="sticky top-0 bg-surface-solid">
          <tr className="h-9 border-b border-glass-border">
            <th scope="col" className="w-8 px-2 text-left text-[11px] text-text-muted">
              #
            </th>
            {cols.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn(
                  'px-2 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap text-text-muted uppercase',
                  c.num ? 'text-right' : 'text-left',
                  c.wide && 'hidden md:table-cell',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr
              key={r.key}
              tabIndex={0}
              data-testid="ranking-row"
              onClick={() => onOpen(r.entity)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(r.entity);
                }
              }}
              className="h-10 cursor-pointer border-b border-glass-border/50 outline-none last:border-b-0 hover:bg-tile focus-visible:bg-tile focus-visible:shadow-[inset_2px_0_0_var(--accent)]"
            >
              <td className="px-2 text-xs text-text-faint tabular-nums">{k + 1}</td>
              {r.cells.map((v, ci) => (
                <td
                  key={cols[ci]!.id}
                  className={cn(
                    'px-2',
                    cols[ci]!.num ? 'text-right tabular-nums' : 'font-semibold',
                    cols[ci]!.wide && 'hidden md:table-cell',
                  )}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="p-6 text-center text-sm text-text-muted">No data for this period.</p>
      )}
    </div>
  );
}
