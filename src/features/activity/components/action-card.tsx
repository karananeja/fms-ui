import type { ActionCard as ActionCardData, ActionStatus } from '@shared/contract/index.ts';
import { ArrowRight, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { errorText } from '@/features/access/lib/access-format';
import { Button } from '@/shared/ui/button';
import { cancelAction, confirmAction, getAction, undoAction } from '../api/activity-api';
import { ACTION_STATUS, AREA_ICON, AREA_LABEL } from '../lib/activity-format';

export interface ActionCardProps {
  action: ActionCardData;
  /** Overrides `action.status` (e.g. while a request is in flight). */
  status?: ActionStatus;
  onConfirm?: () => void;
  onCancel?: () => void;
  onUndo?: () => void;
  /** A request is in flight: buttons are disabled. */
  busy?: boolean;
  /** The last request's error (e.g. "This changed since it was proposed…"). */
  error?: string | null;
}

/**
 * F29 action card (both chats): area icon, summary, before → after rows (5, then "+N more"),
 * whether it can be undone, then Confirm / Cancel. After a decision: Done (with Undo while
 * possible), Cancelled, Expired or Failed with the reason.
 */
export function ActionCard({
  action,
  status = action.status,
  onConfirm,
  onCancel,
  onUndo,
  busy,
  error,
}: ActionCardProps) {
  const Icon = AREA_ICON[action.area];
  const pill = ACTION_STATUS[status];
  const reason = error ?? (status === 'failed' || status === 'expired' ? action.error : null);
  return (
    <section
      aria-label={`Proposed action: ${action.summary}`}
      data-testid="action-card"
      data-status={status}
      className="rounded-tile border border-tile-border bg-tile p-3 text-sm"
    >
      <header className="flex items-start gap-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent"
          title={AREA_LABEL[action.area]}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">{action.summary}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {AREA_LABEL[action.area]} · {action.target.label}
          </p>
        </div>
        <TintPill color={pill.color} data-status={status}>
          {pill.label}
        </TintPill>
      </header>

      {action.rows.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="What will change">
          {action.rows.map((r, k) => (
            <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs">
              <span className="truncate text-text-muted">{r.label}</span>
              <span className="flex min-w-0 items-center gap-1.5 justify-self-end">
                {r.before !== null && (
                  <span className="truncate text-text-faint line-through">{r.before}</span>
                )}
                {r.before !== null && r.after !== null && (
                  <ArrowRight className="size-3 shrink-0 text-text-faint" aria-label="to" />
                )}
                <span className="truncate font-semibold text-text">{r.after ?? 'Removed'}</span>
              </span>
            </li>
          ))}
          {action.more > 0 && <li className="text-xs text-text-muted">+{action.more} more</li>}
        </ul>
      )}

      <p className="mt-3 text-xs text-text-muted">
        {action.undoable ? 'Can be undone for 24 hours.' : "Can't be undone."}
      </p>
      {action.result && status === 'done' && (
        <p className="mt-1 text-xs break-all text-text">{action.result}</p>
      )}
      {reason && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {reason}
        </p>
      )}

      {status === 'proposed' && (onConfirm || onCancel) && (
        <div className="mt-3 flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
          {onConfirm && (
            <Button size="sm" disabled={busy} onClick={onConfirm}>
              Confirm
            </Button>
          )}
        </div>
      )}
      {status === 'done' && action.canUndo && onUndo && (
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" disabled={busy} onClick={onUndo}>
            <Undo2 aria-hidden />
            Undo
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * `ActionCard` that calls the API itself (Confirm / Cancel / Undo) and keeps the latest card;
 * `onChange` reports each new card (e.g. to refresh the thread).
 */
export function LiveActionCard({
  initial,
  onChange,
}: {
  initial: ActionCardData;
  onChange?: (card: ActionCardData) => void;
}) {
  const [card, setCard] = useState(initial);
  // A card from a saved reply may be stale (confirmed elsewhere, expired): re-read it once.
  useEffect(() => {
    if (initial.status !== 'proposed' && !initial.canUndo) return;
    const ac = new AbortController();
    getAction(initial.id, { signal: ac.signal }).then(setCard, () => {});
    return () => ac.abort();
  }, [initial.id, initial.status, initial.canUndo]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (call: (id: string) => Promise<ActionCardData>) => async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await call(card.id);
      setCard(next);
      onChange?.(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ActionCard
      action={card}
      busy={busy}
      error={error}
      onConfirm={run(confirmAction)}
      onCancel={run(cancelAction)}
      onUndo={run(undoAction)}
    />
  );
}
