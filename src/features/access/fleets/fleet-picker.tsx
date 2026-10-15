import type { Fleet } from '@shared/contract/index.ts';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronRight, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/utils';
import { buildFleetIndex, impliedBy, isInSubtree, visibleRows } from './fleet-tree-model';
import { windowOrFirst } from './use-store';

interface FleetPickerBaseProps {
  /** Fleets to choose from: the flat `GET /api/fleets` list (already scoped by the server). */
  fleets: readonly Fleet[];
  /** Hides this fleet and its whole subtree (a fleet can't move under itself, F03-R5). */
  excludeSubtreeOf?: string;
  /**
   * Hides fleets deeper than this (1 = root). For a move target pass
   * `MAX_FLEET_DEPTH - height of the moved subtree`, so the result stays within 5 levels.
   */
  maxDepth?: number;
  disabled?: boolean;
  /** Shown while nothing is selected. */
  placeholder?: string;
  /** Accessible name when there is no visible `<label>` pointing at `id`. */
  'aria-label'?: string;
  /** For `<label htmlFor>` (lands on the picker's search box). */
  id?: string;
  className?: string;
}

/**
 * F03-R7: the shared fleet picker. `single` picks one fleet (move targets, F03a);
 * `multi` picks a fleet scope (invites and users, F03b), where a selected fleet implies its
 * subtree, so `value` holds only the chosen fleets, never their descendants.
 */
export type FleetPickerProps = FleetPickerBaseProps &
  (
    | { mode: 'single'; value: string | null; onChange: (fleetId: string | null) => void }
    | { mode: 'multi'; value: readonly string[]; onChange: (fleetIds: string[]) => void }
  );

const ROW_H = 36;
const LIST_H = 256;

/**
 * F03-R7: searchable, virtualised tree. Search keeps matches and their ancestors; arrow keys move
 * through the rows (tree ARIA pattern with `aria-activedescendant`), Space / Enter picks.
 */
export function FleetPicker(props: FleetPickerProps) {
  const { fleets, excludeSubtreeOf, maxDepth, disabled, placeholder, className } = props;
  const autoId = useId();
  const searchId = props.id ?? `${autoId}-search`;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildFleetIndex(fleets), [fleets]);
  const rows = useMemo(
    () =>
      visibleRows(index, {
        isExpanded: (id) => !collapsed.has(id),
        query,
        excludeSubtreeOf,
        maxDepth,
      }),
    [index, collapsed, query, excludeSubtreeOf, maxDepth],
  );
  const multiValue = props.mode === 'multi' ? props.value : null;
  const singleValue = props.mode === 'single' ? props.value : null;
  const implied = useMemo(
    () => (multiValue ? impliedBy(index, multiValue) : new Map<string, string>()),
    [index, multiValue],
  );
  const selected = useMemo(
    () => new Set(multiValue ?? (singleValue ? [singleValue] : [])),
    [multiValue, singleValue],
  );

  // TanStack Virtual is not React-compiler compatible; nothing here is memoised on its output.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 6,
    initialRect: { width: 360, height: LIST_H },
  });

  const found = rows.findIndex((r) => r.fleet.id === active);
  const activeIndex = Math.max(0, found);
  const rowId = (fleetId: string) => `${autoId}-row-${fleetId}`;

  const pick = (f: Fleet) => {
    if (disabled) return;
    setActive(f.id);
    if (props.mode === 'single') {
      props.onChange(f.id);
      return;
    }
    if (implied.has(f.id)) return;
    if (props.value.includes(f.id)) props.onChange(props.value.filter((v) => v !== f.id));
    // Choosing a fleet replaces any chosen descendants (they are implied now).
    else
      props.onChange([
        ...props.value.filter((v) => !index.byId.has(v) || !isInSubtree(index, v, f.id)),
        f.id,
      ]);
  };

  const setOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => {
      if (prev.has(id) !== open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });

  const moveTo = (i: number) => {
    const at = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[at];
    if (!r) return;
    setActive(r.fleet.id);
    virtualizer.scrollToIndex(at);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const row = found >= 0 ? rows[found] : undefined;
    switch (e.key) {
      case 'ArrowDown':
        moveTo(found < 0 ? 0 : found + 1);
        break;
      case 'ArrowUp':
        moveTo(activeIndex - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row?.hasChildren && !row.expanded) setOpen(row.fleet.id, true);
        else if (row?.expanded) moveTo(found + 1);
        break;
      case 'ArrowLeft':
        if (row?.expanded && !query) setOpen(row.fleet.id, false);
        else if (row?.fleet.parentId) {
          const p = rows.findIndex((r) => r.fleet.id === row.fleet.parentId);
          if (p >= 0) moveTo(p);
        }
        break;
      case 'Enter':
      case ' ':
        if (row) pick(row.fleet);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const summary =
    props.mode === 'single'
      ? props.value
        ? (index.byId.get(props.value)?.name ?? null)
        : null
      : props.value.length === 0
        ? null
        : props.value.length === 1
          ? (index.byId.get(props.value[0]!)?.name ?? '1 fleet')
          : `${props.value.length} fleets`;

  const items = windowOrFirst(virtualizer.getVirtualItems(), rows.length, ROW_H);
  const label = props['aria-label'];

  return (
    <div
      data-slot="fleet-picker"
      className={cn(
        'flex flex-col overflow-hidden rounded-tile border border-tile-border bg-tile text-sm',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-tile-border px-3">
        <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              scroller.current?.focus();
              moveTo(0);
            }
          }}
          placeholder="Search fleets"
          aria-label={label ? `Search ${label}` : 'Search fleets'}
          className="h-9 min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-muted"
        />
      </div>
      <p
        className="truncate border-b border-tile-border px-3 py-1.5 text-xs text-text-muted"
        aria-live="polite"
        data-testid="fleet-picker-summary"
      >
        {summary ? (
          <>
            Selected: <span className="font-semibold text-text">{summary}</span>
          </>
        ) : (
          (placeholder ?? (props.mode === 'single' ? 'Choose a fleet' : 'Choose fleets'))
        )}
      </p>
      <div
        ref={scroller}
        role="tree"
        tabIndex={disabled ? -1 : 0}
        aria-label={label ?? 'Fleets'}
        aria-multiselectable={props.mode === 'multi' || undefined}
        aria-activedescendant={found >= 0 ? rowId(active!) : undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="group/picker relative overflow-y-auto outline-none"
        style={{ height: Math.min(LIST_H, Math.max(ROW_H, rows.length * ROW_H)) }}
      >
        {rows.length === 0 && (
          <p className="px-3 py-2 text-text-muted">{query ? 'No fleets match' : 'No fleets'}</p>
        )}
        <div style={{ height: virtualizer.getTotalSize() }} className="relative">
          {items.map((v) => {
            const r = rows[v.index]!;
            const f = r.fleet;
            const via = implied.get(f.id);
            const isSelected = selected.has(f.id);
            const checked = isSelected || via !== undefined;
            return (
              <div
                key={f.id}
                id={rowId(f.id)}
                role="treeitem"
                aria-label={f.name}
                aria-level={r.level}
                aria-posinset={r.posInSet}
                aria-setsize={r.setSize}
                aria-expanded={r.hasChildren ? r.expanded : undefined}
                aria-selected={checked}
                aria-disabled={via ? true : undefined}
                data-fleet-id={f.id}
                title={
                  via ? `Included with ${index.byId.get(via)?.name ?? 'its parent'}` : undefined
                }
                onClick={() => pick(f)}
                className={cn(
                  'absolute inset-x-0 flex cursor-pointer items-center gap-1.5 pr-3 hover:bg-accent-soft/60',
                  f.id === active &&
                    'group-focus-visible/picker:ring-2 group-focus-visible/picker:ring-ring group-focus-visible/picker:ring-inset',
                  isSelected && props.mode === 'single' && 'bg-accent-soft text-accent',
                  via && 'cursor-default text-text-muted',
                  !r.match && 'text-text-muted',
                )}
                style={{
                  height: ROW_H,
                  transform: `translateY(${v.start}px)`,
                  paddingLeft: 8 + (r.level - 1) * 16,
                }}
              >
                <span
                  aria-hidden
                  onClick={(e) => {
                    if (!r.hasChildren || query) return;
                    e.stopPropagation();
                    setOpen(f.id, !r.expanded);
                  }}
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded text-text-muted',
                    r.hasChildren && !query && 'hover:text-text',
                  )}
                >
                  {r.hasChildren && (
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', r.expanded && 'rotate-90')}
                    />
                  )}
                </span>
                {props.mode === 'multi' ? (
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-label={f.name}
                    checked={checked}
                    disabled={via !== undefined || disabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => pick(f)}
                    className={cn('size-4 shrink-0 accent-[var(--accent)]', via && 'opacity-50')}
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-4 shrink-0 place-items-center rounded-full border border-tile-border',
                      isSelected && 'border-accent bg-accent text-primary-foreground',
                    )}
                  >
                    {isSelected && <Check className="size-3" />}
                  </span>
                )}
                <span
                  className={cn('min-w-0 flex-1 truncate', r.match && query && 'font-semibold')}
                >
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-text-muted tabular-nums">
                  {f.vehicleCount.toLocaleString('en-IN')}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
