import { Check, LoaderCircle, Undo2, X } from 'lucide-react';
import type { ChangeSet, ToolChip } from '@shared/contract/dashboards.ts';
import { cn } from '@/shared/lib/utils';

/**
 * F19 §7: one dashboard change made by the assistant ("Added widget: Top idle vehicles").
 * Undo shows only on the turn's change while it is undoable and nothing streams; an undone
 * change shows an "Undone" badge.
 */
export function ChangeChip({
  chip,
  change,
  showUndo = false,
  undoing = false,
  onUndo,
}: {
  chip: ToolChip;
  change?: ChangeSet | null;
  /** The caller decides which chip of the turn carries Undo (usually the last change). */
  showUndo?: boolean;
  undoing?: boolean;
  onUndo?(): void;
}) {
  const ok = chip.status === 'ok';
  const undone = ok && !!change?.undoneAt;
  return (
    <li
      data-testid="change-chip"
      data-status={chip.status}
      data-undone={undone || undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
        ok ? 'border-accent/40 bg-accent-soft text-text' : 'border-danger/40 bg-tile text-danger',
        undone && 'opacity-70',
      )}
    >
      {ok ? (
        <Check className="size-3 shrink-0 text-ok" aria-label="Done" />
      ) : (
        <X className="size-3 shrink-0" aria-label="Failed" />
      )}
      <span className={cn('truncate', undone && 'line-through')}>{chip.label}</span>
      {undone && (
        <span
          data-testid="change-undone"
          className="rounded bg-tile px-1.5 py-px text-[10px] tracking-wider text-text-muted uppercase"
        >
          Undone
        </span>
      )}
      {ok && !undone && showUndo && change?.undoable && onUndo && (
        <button
          type="button"
          data-testid="change-undo"
          onClick={onUndo}
          disabled={undoing}
          className="-my-0.5 ml-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {undoing ? (
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
          ) : (
            <Undo2 className="size-3" aria-hidden />
          )}
          Undo
        </button>
      )}
    </li>
  );
}
