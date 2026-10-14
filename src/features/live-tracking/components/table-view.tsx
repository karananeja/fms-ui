import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, LocateFixed } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { COLUMN_BY_ID, type TableColumnId, type TableRow } from '../config/table-columns';
import { formatRelative } from '../lib/format-relative';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { tableViewStore, type TableViewStore } from '../store/table-view';
import { useLiveTracking } from '../store/use-live-tracking';
import { useTableView } from '../store/use-table-view';
import { StatusPill } from './status-pill';
import { TableToolbar } from './table-toolbar';
import { DESKTOP_QUERY } from './vehicle-details-panel';

const ROW_H = 40;
/** Rows fetched beyond the visible range on each side (F09-R3). */
const BUFFER = 50;
const WIDTH: Record<TableColumnId, number> = {
  regno: 150,
  vin: 190,
  deviceId: 170,
  fleet: 170,
  status: 150,
  speed: 120,
  soc: 100,
  dte: 110,
  odometer: 120,
  ignition: 100,
  gpstime: 200,
  canutctime: 200,
  location: 210,
};

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const DASH = '—';
const n0 = (v: number | null) => (v === null ? DASH : grouped.format(v));

/** IST time; the relative age is computed on hover, so no per-cell timers or periodic re-renders. */
function timeCell(at: number | null): ReactNode {
  if (at === null) return DASH;
  return (
    <span onPointerEnter={(e) => (e.currentTarget.title = formatRelative(at, Date.now()))}>
      {formatIst(at)}
    </span>
  );
}

/**
 * Cell content as plain strings where possible: a plain call, not a component, so a row mounts
 * few React elements (scroll renders whole windows of new rows, F09-T7 budget).
 */
function cellContent(
  id: TableColumnId,
  row: TableRow,
  fleets: Readonly<Record<string, string>>,
): ReactNode {
  switch (id) {
    case 'regno':
      return <span className="font-extrabold">{row.regno || DASH}</span>;
    case 'vin':
    case 'deviceId':
      return row[id] || DASH;
    case 'fleet':
      return fleets[row.fleetId] ?? row.fleetId;
    case 'status':
      return row.status ? <StatusPill status={row.status} /> : DASH;
    case 'speed':
    case 'soc':
    case 'dte':
      return n0(row[id]);
    case 'odometer':
      return row.odometer === null ? DASH : grouped.format(Math.floor(row.odometer));
    case 'ignition':
      return row.ignition === 1 ? 'On' : row.ignition === 0 ? 'Off' : DASH;
    case 'gpstime':
    case 'canutctime':
      return timeCell(row[id]);
    case 'location':
      return row.lat === null || row.lng === null
        ? DASH
        : `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`;
  }
}

type RowProps = {
  index: number;
  start: number;
  row: TableRow | undefined;
  columns: TableColumnId[];
  fleets: Readonly<Record<string, string>>;
  selected: boolean;
  onSelect: (vehicleId: string) => void;
  onLocate: (vehicleId: string) => void;
};

/** Field-wise row equality: the worker sends fresh objects for every window, mostly unchanged. */
function sameRow(a: TableRow | undefined, b: TableRow | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k in a) if (a[k as keyof TableRow] !== b[k as keyof TableRow]) return false;
  return true;
}

const sameRowProps = (a: RowProps, b: RowProps) =>
  a.index === b.index &&
  a.start === b.start &&
  a.columns === b.columns &&
  a.fleets === b.fleets &&
  a.selected === b.selected &&
  a.onSelect === b.onSelect &&
  a.onLocate === b.onLocate &&
  sameRow(a.row, b.row);

/**
 * One virtual row. Memoised on the row's values (not its object identity), so a window response
 * or live push only re-renders rows that entered the window or whose values changed.
 */
const VehicleRow = memo(function VehicleRow({
  index,
  start,
  row: r,
  columns,
  fleets,
  selected,
  onSelect,
  onLocate,
}: RowProps) {
  const id = r?.vehicleId;
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-vehicle-id={id}
      onClick={() => id && onSelect(id)}
      className={cn(
        'group absolute inset-x-0 flex cursor-pointer border-b border-glass-border/50 text-sm hover:bg-tile',
        selected && 'bg-accent-soft hover:bg-accent-soft',
      )}
      style={{ height: ROW_H, transform: `translateY(${start}px)` }}
    >
      {r
        ? columns.map((cid, k) => (
            <div
              key={cid}
              role="cell"
              style={{ width: WIDTH[cid] }}
              className={cn(
                'flex shrink-0 items-center px-3',
                COLUMN_BY_ID[cid].numeric && 'justify-end tabular-nums',
                // The sticky cell is opaque (rows scroll under it) and carries the row tint on top.
                k === 0 &&
                  'sticky left-0 z-[1] bg-map-bg group-hover:bg-[image:linear-gradient(var(--tile),var(--tile))] lg:bg-surface-solid',
                k === 0 &&
                  selected &&
                  'bg-[image:linear-gradient(var(--accent-soft),var(--accent-soft))] group-hover:bg-[image:linear-gradient(var(--accent-soft),var(--accent-soft))]',
              )}
            >
              <span className="min-w-0 truncate">{cellContent(cid, r, fleets)}</span>
            </div>
          ))
        : columns.map((cid) => (
            <div
              key={cid}
              role="cell"
              style={{ width: WIDTH[cid] }}
              className="flex shrink-0 items-center px-3"
            >
              <span className="h-3 w-2/3 animate-pulse rounded bg-tile" aria-hidden />
            </div>
          ))}
      <div role="cell" className="flex w-14 shrink-0 items-center justify-center">
        {id && (
          <button
            type="button"
            aria-label={`Locate ${r.regno || id}`}
            onClick={(e) => {
              e.stopPropagation();
              onLocate(id);
            }}
            className="grid size-8 place-items-center rounded-[10px] text-text-muted outline-none hover:bg-tile hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LocateFixed className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}, sameRowProps);

const selectSelected = (s: LiveTrackingState) => s.selectedVehicleId;

/**
 * F09: virtualised table of matching vehicles. Sorting and windowing run in the worker; only the
 * visible rows (+ buffer) are fetched and about 50 rows are in the DOM.
 */
export function TableView({
  onBack,
  onLocate,
  store = tableViewStore,
  live = liveTrackingStore,
}: {
  onBack: () => void;
  /** Switches to the map and locates the vehicle (F09-R9). */
  onLocate: (vehicleId: string) => void;
  store?: TableViewStore;
  live?: LiveTrackingStore;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const columns = useTableView((s) => s.columns, store);
  const sort = useTableView((s) => s.sort, store);
  const result = useTableView((s) => s.result, store);
  const offset = useTableView((s) => s.offset, store);
  const fleets = useTableView((s) => s.fleetNames, store);
  const selected = useLiveTracking(selectSelected, Object.is, live);
  const scroller = useRef<HTMLDivElement>(null);
  // Stable callbacks so memoised rows only re-render when their own data changes.
  const locateRef = useRef(onLocate);
  useEffect(() => {
    locateRef.current = onLocate;
  });
  const locate = useMemo(() => (id: string) => locateRef.current(id), []);
  const select = useMemo(() => (id: string) => void live.selectVehicle(id), [live]);

  useEffect(() => {
    store.open(desktop ? 'desktop' : 'mobile');
    return () => store.close();
  }, [store, desktop]);

  const total = result?.total ?? 0;
  const rows = result?.rows ?? [];
  // TanStack Table drives the header; rows render straight from the worker window (VehicleRow).
  const defs = useMemo<ColumnDef<TableRow>[]>(
    () =>
      columns.map((id) => ({
        id,
        header: COLUMN_BY_ID[id].label,
        size: WIDTH[id],
      })),
    [columns],
  );
  // TanStack Table (approved F09 dependency) is not React-compiler compatible; this component
  // is left uncompiled and passes none of its functions to memoised children.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    getRowId: (r) => r.vehicleId,
  });

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    // Small overscan: a wheel step or scrollbar jump mounts a whole window of new rows (F09-T7).
    overscan: 4,
    // Let React batch scroll renders instead of a synchronous render per scroll event (F09 budget).
    useFlushSync: false,
    // Until the scroller is measured (and in jsdom): a typical viewport.
    initialRect: { width: 1200, height: 800 },
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.at(-1)?.index ?? 0;

  // Ask the worker for the visible range + buffer once it leaves the loaded window.
  useEffect(() => {
    const loadedEnd = offset + rows.length;
    const need = first < offset || (last >= loadedEnd && loadedEnd < total);
    if (need || rows.length === 0) {
      const from = Math.max(0, first - BUFFER);
      store.setRange(from, Math.min(200, last - from + 1 + BUFFER));
    }
  }, [first, last, offset, rows.length, total, store]);

  const width = columns.reduce((a, id) => a + WIDTH[id], 0) + 56;
  const header = table.getHeaderGroups()[0]!;

  return (
    <section
      aria-label="Vehicle table"
      data-testid="table-view"
      className={cn(
        'absolute inset-0 z-[15] flex flex-col overflow-hidden bg-map-bg lg:inset-3.5 lg:rounded-[var(--radius-panel)] lg:shadow-[0_30px_80px_rgb(0_0_0/0.55)] lg:glass',
        // The details card (420 px + gutters) sits beside the table, not over its Locate column.
        selected && 'lg:right-[448px]',
      )}
    >
      <TableToolbar onBack={onBack} store={store} live={live} />
      <div ref={scroller} data-testid="table-scroller" className="min-h-0 flex-1 overflow-auto">
        <div
          role="table"
          aria-label="Vehicles"
          aria-rowcount={total + 1}
          style={{ width, minWidth: '100%' }}
        >
          <div role="rowgroup" className="sticky top-0 z-10 bg-surface-solid">
            <div role="row" aria-rowindex={1} className="flex h-10 border-b border-glass-border">
              {header.headers.map((h, k) => {
                const id = h.column.id as TableColumnId;
                const active = sort.column === id;
                const numeric = COLUMN_BY_ID[id].numeric;
                return (
                  <div
                    key={h.id}
                    role="columnheader"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ width: h.getSize() }}
                    className={cn('shrink-0', k === 0 && 'sticky left-0 z-10 bg-surface-solid')}
                  >
                    <button
                      type="button"
                      onClick={() => store.toggleSort(id)}
                      className={cn(
                        'flex h-full w-full items-center gap-1 px-3 text-[11px] font-black tracking-[0.12em] text-text-muted uppercase outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                        numeric && 'justify-end',
                        active && 'text-accent',
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {active &&
                        (sort.dir === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ))}
                    </button>
                  </div>
                );
              })}
              <div role="columnheader" aria-label="Actions" className="w-14 shrink-0" />
            </div>
          </div>
          <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((v) => {
              const r = rows[v.index - offset];
              const id = r?.vehicleId;
              return (
                <VehicleRow
                  key={v.index}
                  index={v.index}
                  start={v.start}
                  row={r}
                  columns={columns}
                  fleets={fleets}
                  selected={!!id && id === selected}
                  onSelect={select}
                  onLocate={locate}
                />
              );
            })}
          </div>
        </div>
        {result && total === 0 && (
          <p className="p-6 text-center text-sm text-text-muted">No vehicles match this scope.</p>
        )}
      </div>
    </section>
  );
}
