import type { Fleet } from '@shared/contract/index.ts';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Ellipsis, FolderPlus, MoveRight, PencilLine, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/shared/lib/utils';
import {
  addChildBlocker,
  deleteBlocker,
  moveBlocker,
  type FleetIndex,
  type VisibleRow,
} from './fleet-tree-model';
import type { FleetTreeStore } from './fleet-tree-store';
import { useStore, windowOrFirst } from './use-store';

export type FleetAction = 'add' | 'move' | 'delete';

const ROW_H = 40;
const INDENT = 20;
const counts = new Intl.NumberFormat('en-IN');

interface RowProps {
  row: VisibleRow;
  index: FleetIndex;
  start: number;
  domId: string;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onRowClick: (fleet: Fleet) => void;
  onToggle: (id: string) => void;
  onMenu: (id: string | null) => void;
  onAction: (action: FleetAction, fleet: Fleet) => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string | null) => void;
  onMenuClosed: () => void;
}

function MenuItem({
  icon,
  label,
  reason,
  destructive,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  /** Disabled with this reason (F03-R5). */
  reason?: string | null;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      disabled={!!reason}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-bold outline-none data-highlighted:bg-accent-soft data-highlighted:text-accent',
        destructive && 'text-danger data-highlighted:bg-danger/15 data-highlighted:text-danger',
        reason && 'cursor-default opacity-60',
      )}
    >
      <span className="mt-0.5 [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        {label}
        {reason && <span className="text-xs font-semibold text-text-muted">{reason}</span>}
      </span>
    </DropdownMenu.Item>
  );
}

function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label="Fleet name"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value)}
      className="h-7 min-w-0 flex-1 rounded-md border border-accent/60 bg-bg px-2 text-sm font-bold outline-none"
    />
  );
}

/** One virtual row: depth guides, chevron, name (or rename box), count and the ⋯ menu. */
const TreeRow = memo(function TreeRow({
  row,
  index,
  start,
  domId,
  selected,
  active,
  renaming,
  menuOpen,
  onRowClick,
  onToggle,
  onMenu,
  onAction,
  onStartRename,
  onRename,
  onMenuClosed,
}: RowProps) {
  const f = row.fleet;
  const temp = f.id.startsWith('tmp-');
  const moveReason = moveBlocker(index, f);
  return (
    <div
      id={domId}
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={selected}
      aria-label={f.name}
      data-fleet-id={f.id}
      onClick={() => onRowClick(f)}
      className={cn(
        'group absolute inset-x-0 flex cursor-pointer items-center gap-1 border-b border-glass-border/50 pr-2 text-sm hover:bg-tile',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        active &&
          'group-focus-visible/tree:shadow-[inset_0_0_0_2px_var(--ring)] group-focus-visible/tree:outline-none',
        temp && 'opacity-60',
      )}
      style={{ height: ROW_H, transform: `translateY(${start}px)` }}
    >
      {/* Depth guides: one vertical line per ancestor level. */}
      {Array.from({ length: row.level - 1 }, (_, k) => (
        <span
          key={k}
          aria-hidden
          className="absolute inset-y-0 border-l border-glass-border"
          style={{ left: 22 + k * INDENT }}
        />
      ))}
      <span style={{ width: 12 + (row.level - 1) * INDENT }} className="shrink-0" aria-hidden />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={(e) => {
          e.stopPropagation();
          if (row.hasChildren) onToggle(f.id);
        }}
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-md text-text-muted',
          row.hasChildren ? 'hover:bg-tile hover:text-text' : 'invisible',
        )}
      >
        <ChevronRight className={cn('size-4 transition-transform', row.expanded && 'rotate-90')} />
      </button>
      {renaming ? (
        <RenameInput initial={f.name} onDone={(name) => onRename(f.id, name)} />
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-bold',
            selected && 'text-accent',
            !row.match && 'text-text-muted',
          )}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!temp) onStartRename(f.id);
          }}
        >
          {f.name}
        </span>
      )}
      <span
        className="shrink-0 px-2 text-xs font-semibold text-text-muted tabular-nums"
        data-testid="fleet-count"
        title={`${counts.format(f.vehicleCount)} vehicles in this fleet and below`}
      >
        {counts.format(f.vehicleCount)}
      </span>
      <DropdownMenu.Root
        modal={false}
        open={menuOpen}
        onOpenChange={(o) => onMenu(o ? f.id : null)}
      >
        <DropdownMenu.Trigger
          tabIndex={-1}
          disabled={temp}
          aria-label={`Actions for ${f.name}`}
          onClick={(e) => e.stopPropagation()}
          className="grid size-8 shrink-0 place-items-center rounded-[10px] text-text-muted opacity-70 outline-none group-hover:opacity-100 hover:bg-tile hover:text-accent data-[state=open]:bg-tile data-[state=open]:text-accent data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-4" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            onClick={(e) => e.stopPropagation()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              onMenuClosed();
            }}
            className="z-50 w-64 rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-[0_16px_40px_var(--shadow)]"
          >
            <MenuItem
              icon={<FolderPlus />}
              label="Add child fleet"
              reason={addChildBlocker(f)}
              onSelect={() => onAction('add', f)}
            />
            <MenuItem icon={<PencilLine />} label="Rename" onSelect={() => onStartRename(f.id)} />
            <MenuItem
              icon={<MoveRight />}
              label="Move…"
              reason={moveReason}
              onSelect={() => onAction('move', f)}
            />
            <DropdownMenu.Separator className="my-1 h-px bg-glass-border" />
            <MenuItem
              icon={<Trash2 />}
              label="Delete"
              destructive
              reason={deleteBlocker(index, f)}
              onSelect={() => onAction('delete', f)}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
});

/**
 * F03-R4: the virtualised fleet tree (tree ARIA pattern: the tree holds focus and points at the
 * active row with `aria-activedescendant`, so virtualised rows needn't be focusable).
 * Keys: ↑/↓, Home/End, → expand / first child, ← collapse / parent, Enter/Space select, F2 rename,
 * Shift+F10 / Menu opens the row menu.
 */
export function FleetTree({
  store,
  onActivate,
  onAction,
  className,
}: {
  store: FleetTreeStore;
  /** A row was chosen by click or Enter (the page opens the vehicles sheet on mobile). */
  onActivate: (fleet: Fleet) => void;
  onAction: (action: FleetAction, fleet: Fleet) => void;
  className?: string;
}) {
  const rows = useStore(store, (s) => s.rows);
  const index = useStore(store, (s) => s.index);
  const selectedId = useStore(store, (s) => s.selectedId);
  const query = useStore(store, (s) => s.query);
  const [active, setActive] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const domId = (id: string) => `${prefix}-fleet-${id}`;

  // TanStack Virtual is not React-compiler compatible; rows get plain values from it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 8,
    initialRect: { width: 700, height: 600 },
  });

  const activeId = active ?? selectedId;
  const at = rows.findIndex((r) => r.fleet.id === activeId);

  // Stable callbacks for the memoised rows.
  const handlers = useRef({ onActivate, onAction });
  useEffect(() => {
    handlers.current = { onActivate, onAction };
  });
  const [cb] = useState(() => ({
    rowClick: (f: Fleet) => {
      setActive(f.id);
      store.select(f.id);
      handlers.current.onActivate(f);
    },
    toggle: (id: string) => store.toggle(id),
    menu: (id: string | null) => setMenuFor(id),
    action: (a: FleetAction, f: Fleet) => handlers.current.onAction(a, f),
    startRename: (id: string) => {
      setMenuFor(null);
      setRenaming(id);
    },
    rename: (id: string, name: string | null) => {
      setRenaming(null);
      if (name !== null) void store.rename(id, name);
      scroller.current?.focus({ preventScroll: true });
    },
    /** Back to the tree, unless the action moved focus on (rename box, dialog). */
    menuClosed: () => {
      const el = document.activeElement;
      if (!el || el === document.body) scroller.current?.focus({ preventScroll: true });
    },
  }));

  const moveTo = (i: number) => {
    const k = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[k];
    if (!r) return;
    setActive(r.fleet.id);
    virtualizer.scrollToIndex(k);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return;
    const row = at >= 0 ? rows[at] : undefined;
    switch (e.key) {
      case 'ArrowDown':
        moveTo(at < 0 ? 0 : at + 1);
        break;
      case 'ArrowUp':
        moveTo(at < 0 ? 0 : at - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row?.hasChildren && !row.expanded) store.setExpanded(row.fleet.id, true);
        else if (row?.expanded) moveTo(at + 1);
        break;
      case 'ArrowLeft':
        if (row?.expanded && !query) store.setExpanded(row.fleet.id, false);
        else if (row?.fleet.parentId) {
          const p = rows.findIndex((r) => r.fleet.id === row.fleet.parentId);
          if (p >= 0) moveTo(p);
        }
        break;
      case 'Enter':
      case ' ':
        if (row) cb.rowClick(row.fleet);
        break;
      case 'F2':
        if (row) cb.startRename(row.fleet.id);
        break;
      case 'ContextMenu':
        if (row) setMenuFor(row.fleet.id);
        break;
      default:
        if (e.key === 'F10' && e.shiftKey && row) setMenuFor(row.fleet.id);
        else return;
    }
    e.preventDefault();
  };

  const items = windowOrFirst(virtualizer.getVirtualItems(), rows.length, ROW_H);

  return (
    <div
      ref={scroller}
      role="tree"
      tabIndex={0}
      aria-label="Fleet tree"
      aria-activedescendant={at >= 0 ? domId(rows[at]!.fleet.id) : undefined}
      onKeyDown={onKeyDown}
      data-testid="fleet-tree"
      className={cn('group/tree relative min-h-0 overflow-y-auto outline-none', className)}
    >
      {rows.length === 0 && (
        <p className="p-6 text-center text-sm text-text-muted">
          {query ? 'No fleets match your search.' : 'No fleets.'}
        </p>
      )}
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((v) => {
          const r = rows[v.index]!;
          const id = r.fleet.id;
          return (
            <TreeRow
              key={id}
              row={r}
              index={index}
              start={v.start}
              domId={domId(id)}
              selected={id === selectedId}
              active={id === activeId}
              renaming={id === renaming}
              menuOpen={id === menuFor}
              onRowClick={cb.rowClick}
              onToggle={cb.toggle}
              onMenu={cb.menu}
              onAction={cb.action}
              onStartRename={cb.startRename}
              onRename={cb.rename}
              onMenuClosed={cb.menuClosed}
            />
          );
        })}
      </div>
    </div>
  );
}
