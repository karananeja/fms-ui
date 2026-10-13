import { Search } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/shared/lib/utils';
import type { ParameterCell } from '../lib/vehicle-details-model';

export type ParametersVariant = 'list' | 'grid';

interface CellProps {
  pid: string;
  label: string;
  value: string;
  title: string;
  variant: ParametersVariant;
  /** Render probe for tests (F07-T5). */
  onRender?: (pid: string) => void;
}

/** One PID; memoised on primitive props so a push re-renders only the cells whose value changed. */
const ParameterItem = memo(function ParameterItem({
  pid,
  label,
  value,
  title,
  variant,
  onRender,
}: CellProps) {
  onRender?.(pid);
  if (variant === 'list') {
    return (
      <li
        title={title}
        data-pid={pid}
        className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
      >
        <span className="min-w-0 truncate text-xs text-text-muted">{label}</span>
        <span className="shrink-0 font-display text-sm font-bold tabular-nums">{value}</span>
      </li>
    );
  }
  return (
    <li
      title={title}
      data-pid={pid}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] border bg-surface-2/60 px-3 py-2.5"
    >
      <span className="truncate text-[10px] font-semibold tracking-[0.12em] text-text-muted uppercase">
        {label}
      </span>
      <span className="truncate font-display text-xl font-bold tabular-nums">{value}</span>
    </li>
  );
});

export function ParameterSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-3 size-4 text-text-muted" aria-hidden />
      <input
        type="search"
        aria-label="Search parameters"
        placeholder="Search parameters…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

export function ParametersGrid({
  cells,
  variant,
  onCellRender,
}: {
  cells: ParameterCell[];
  variant: ParametersVariant;
  onCellRender?: (pid: string) => void;
}) {
  if (!cells.length) return <p className="py-4 text-sm text-text-muted">No matching parameters</p>;
  return (
    <ul
      aria-label="Parameters"
      className={
        variant === 'grid'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2'
          : 'flex flex-col'
      }
    >
      {cells.map((c) => (
        <ParameterItem
          key={c.key}
          pid={c.key}
          label={c.label}
          value={c.value}
          title={c.title}
          variant={variant}
          onRender={onCellRender}
        />
      ))}
    </ul>
  );
}
