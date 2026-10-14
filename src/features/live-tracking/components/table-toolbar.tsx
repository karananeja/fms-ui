import { ArrowLeft, Columns3, Download, Pause, Play } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/utils';
import { TABLE_COLUMNS } from '../config/table-columns';
import {
  hasPermission,
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { tableViewStore, type TableViewStore } from '../store/table-view';
import { useLiveTracking } from '../store/use-live-tracking';
import { useTableView } from '../store/use-table-view';

const count = new Intl.NumberFormat('en-IN');
const selectCanExport = (s: LiveTrackingState) => hasPermission(s, 'table.export');

function ToolButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-xs font-extrabold tracking-[0.1em] text-text-muted uppercase outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-accent [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

/** F09 toolbar: back to map, scope + count, column menu, pause, export (with `table.export`). */
export function TableToolbar({
  onBack,
  store = tableViewStore,
  live = liveTrackingStore,
}: {
  onBack: () => void;
  store?: TableViewStore;
  live?: LiveTrackingStore;
}) {
  const scope = useTableView((s) => s.scope, store);
  const hasBbox = useTableView((s) => s.bbox !== null, store);
  const total = useTableView((s) => s.result?.total ?? null, store);
  const columns = useTableView((s) => s.columns, store);
  const paused = useTableView((s) => s.paused, store);
  const pending = useTableView((s) => s.pending, store);
  const exporting = useTableView((s) => s.exporting, store);
  const canExport = useLiveTracking(selectCanExport, Object.is, live);

  return (
    <div
      role="toolbar"
      aria-label="Table tools"
      className="flex flex-wrap items-center gap-1.5 border-b border-glass-border p-2"
    >
      <ToolButton onClick={onBack} aria-label="Back to map">
        <ArrowLeft aria-hidden />
        <span className="hidden sm:inline">Map</span>
      </ToolButton>
      <div role="group" aria-label="Scope" className="flex rounded-[12px] bg-tile p-0.5">
        {(['all', 'viewport'] as const).map((s) => (
          <ToolButton
            key={s}
            aria-pressed={scope === s}
            disabled={s === 'viewport' && !hasBbox}
            title={
              s === 'viewport' ? 'Vehicles inside the map view when the table opened' : undefined
            }
            onClick={() => store.setScope(s)}
            className="h-8"
          >
            {s === 'all' ? 'All' : 'Viewport'}
          </ToolButton>
        ))}
      </div>
      <span
        data-testid="table-count"
        className="px-2 text-xs font-extrabold tracking-[0.12em] whitespace-nowrap uppercase"
      >
        {scope === 'all' ? 'All' : 'Viewport'} · {total === null ? '…' : count.format(total)}{' '}
        vehicles
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {paused && (
          <span
            data-testid="paused-badge"
            className="rounded-full bg-warn/15 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.08em] whitespace-nowrap text-warn uppercase"
          >
            Paused · {pending} {pending === 1 ? 'update' : 'updates'}
          </span>
        )}
        <ToolButton
          aria-pressed={paused}
          onClick={() => store.togglePause()}
          aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          <span className="hidden sm:inline">{paused ? 'Resume' : 'Pause'}</span>
        </ToolButton>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <ToolButton aria-label="Columns">
              <Columns3 aria-hidden />
              <span className="hidden sm:inline">Columns</span>
            </ToolButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              aria-label="Columns"
              className="z-50 max-h-[70vh] min-w-48 overflow-auto rounded-tile border border-glass-border bg-surface-solid p-1 shadow-[0_8px_24px_var(--shadow)]"
            >
              {TABLE_COLUMNS.map((c) => (
                <DropdownMenu.CheckboxItem
                  key={c.id}
                  checked={columns.includes(c.id)}
                  disabled={c.id === 'regno'}
                  onCheckedChange={() => store.toggleColumn(c.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs font-extrabold text-text-muted outline-none data-disabled:opacity-50 data-highlighted:bg-accent-soft data-highlighted:text-accent data-[state=checked]:text-text"
                >
                  <span
                    aria-hidden
                    className="grid size-4 place-items-center rounded border border-tile-border text-[10px] data-[on=true]:border-accent data-[on=true]:bg-accent data-[on=true]:text-accent-ink"
                    data-on={columns.includes(c.id)}
                  >
                    {columns.includes(c.id) && '✓'}
                  </span>
                  {c.label}
                </DropdownMenu.CheckboxItem>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {canExport && (
          <ToolButton
            disabled={exporting}
            onClick={() => void store.exportCsv()}
            className="text-accent"
          >
            <Download aria-hidden />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </ToolButton>
        )}
      </div>
    </div>
  );
}
