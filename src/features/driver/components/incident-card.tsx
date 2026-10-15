import type { RequestType } from '@shared/contract/index.ts';
import { CarFront, LifeBuoy, Plus } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { formatAge, formatIstShort } from '@/features/share/public/share-format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  incidentSteps,
  incidentSummary,
  REASON_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  type Incident,
} from '../driver-model';

const PART_LABEL: Record<RequestType, string> = {
  breakdown: 'Report',
  rsa: 'Roadside help',
  replacement: 'Replacement',
};

const ADD: Record<'rsa' | 'replacement', { label: string; icon: typeof LifeBuoy }> = {
  rsa: { label: 'Also need roadside help', icon: LifeBuoy },
  replacement: { label: 'Also need another vehicle', icon: CarFront },
};

function title(i: Incident): string {
  if (i.breakdown?.reason) return REASON_LABEL[i.breakdown.reason].label;
  if (i.breakdown) return 'Problem';
  return i.rsa ? 'Roadside help' : 'Replacement';
}

export interface IncidentCardProps {
  incident: Incident;
  now: number;
  highlight?: boolean;
  /** Help types that can still be added (none of that type open elsewhere). */
  canAdd: readonly ('rsa' | 'replacement')[];
  onAdd: (type: 'rsa' | 'replacement') => Promise<void>;
}

/**
 * F13 / D-109: one incident (a breakdown and the help asked for it) with the state of each part
 * and one merged timeline. While it is open the driver can add help they didn't ask for at first.
 */
export const IncidentCard = forwardRef<HTMLElement, IncidentCardProps>(function IncidentCard(
  { incident: i, now, highlight, canAdd, onAdd },
  ref,
) {
  const [confirm, setConfirm] = useState<'rsa' | 'replacement' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = incidentSteps(i);
  const note = i.breakdown?.note || i.requests[0]!.note;
  const addable = i.open ? canAdd.filter((t) => !i[t]) : [];

  const add = async (type: 'rsa' | 'replacement') => {
    setPending(true);
    setError(null);
    try {
      await onAdd(type);
      setConfirm(null);
    } catch {
      setError('Couldn’t send. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <article
      ref={ref}
      aria-label={`Incident: ${title(i)}`}
      data-testid="incident-card"
      data-incident-id={i.id}
      data-open={i.open}
      className={cn(
        'rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid p-4 transition-shadow',
        highlight && 'shadow-[0_0_0_2px_var(--accent)]',
        !i.open && 'opacity-80',
      )}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{title(i)}</h3>
          <p className="text-xs text-text-muted" data-testid="incident-summary">
            {incidentSummary(i)}
          </p>
        </div>
        <TintPill color={i.open ? 'var(--warn)' : 'var(--ok)'}>
          {i.open ? 'Open' : 'Closed'}
        </TintPill>
      </header>
      {note && <p className="mt-1 text-xs text-text-muted">“{note}”</p>}

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Parts">
        {i.requests.map((r) => (
          <li
            key={r.id}
            data-testid={`part-${r.type}`}
            data-request-id={r.id}
            data-status={r.status}
            className="flex items-center gap-1.5 rounded-full border border-tile-border bg-tile px-2.5 py-1 text-[11px]"
          >
            <span className="font-semibold">{PART_LABEL[r.type]}</span>
            <span
              className="size-1.5 rounded-full"
              style={{ background: STATUS_COLOR[r.status] }}
            />
            <span className="text-text-muted">{STATUS_LABEL[r.status]}</span>
          </li>
        ))}
      </ul>

      <ol aria-label="Timeline" className="mt-3 flex flex-col">
        {steps.map((e, k) => {
          const last = k === steps.length - 1;
          return (
            <li key={e.key} className="relative flex gap-3 pb-3 last:pb-0" data-testid="step">
              {!last && (
                <span
                  aria-hidden
                  className="absolute top-3 left-[5px] h-full w-px bg-tile-border"
                />
              )}
              <span
                aria-hidden
                className="relative mt-1 size-[11px] shrink-0 rounded-full border-2"
                style={{
                  borderColor: STATUS_COLOR[e.status],
                  background: last ? STATUS_COLOR[e.status] : 'transparent',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{e.text}</p>
                {e.note && <p className="text-xs text-text-muted">{e.note}</p>}
                <p className="text-[11px] text-text-faint" title={formatIstShort(e.at)}>
                  {formatIstShort(e.at)} · {formatAge(e.at, now)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {addable.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-tile-border pt-3">
          {confirm ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">{ADD[confirm].label}?</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void add(confirm)} disabled={pending}>
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          ) : (
            addable.map((t) => {
              const { label, icon: Icon } = ADD[t];
              return (
                <Button
                  key={t}
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => setConfirm(t)}
                >
                  <Plus aria-hidden />
                  <Icon aria-hidden />
                  {label}
                </Button>
              );
            })
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
});
