import type { FleetSettings } from '@shared/contract/index.ts';
import { useState } from 'react';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { cn } from '@/shared/lib/utils';
import { fleetSettings, setAutoAssign } from '../api/requests-api';

/**
 * F14-R4 / D-102: "Assign replacements automatically" for one fleet (`fleets.manage`). Shows
 * whether the value is set here or inherited from a parent fleet; "Use parent setting" clears
 * this fleet's own value. Renders nothing without the permission.
 */
export function FleetAutoAssignToggle({
  fleetId,
  className,
  load = fleetSettings,
  save = setAutoAssign,
}: {
  fleetId: string;
  className?: string;
  load?: (fleetId: string, opts: { signal: AbortSignal }) => Promise<FleetSettings>;
  save?: (fleetId: string, value: boolean | null) => Promise<FleetSettings>;
}) {
  const allowed = useCan('fleets.manage');
  if (!allowed) return null;
  return <Toggle fleetId={fleetId} className={className} load={load} save={save} />;
}

function Toggle({
  fleetId,
  className,
  load,
  save,
}: {
  fleetId: string;
  className?: string;
  load: (fleetId: string, opts: { signal: AbortSignal }) => Promise<FleetSettings>;
  save: (fleetId: string, value: boolean | null) => Promise<FleetSettings>;
}) {
  const res = useResource((signal) => load(fleetId, { signal }), fleetId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = res.data;

  const change = async (value: boolean | null) => {
    setPending(true);
    setError(null);
    try {
      const next = await save(fleetId, value);
      res.setData(() => next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  const on = s?.autoAssignReplacement ?? false;
  return (
    <div
      data-testid="auto-assign"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-tile border border-tile-border bg-tile px-3 py-2',
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Assign replacements automatically"
        disabled={!s || pending}
        onClick={() => void change(!on)}
        className="group flex items-center gap-2.5 text-sm font-bold outline-none disabled:opacity-60"
      >
        <span
          aria-hidden
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full border border-tile-border transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
            on ? 'bg-accent' : 'bg-surface-solid',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-3.5 rounded-full bg-text transition-[left]',
              on ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </span>
        Assign replacements automatically
      </button>
      <span className="text-xs text-text-muted" data-testid="auto-assign-source">
        {!s
          ? res.error
            ? errorText(res.error)
            : 'Loading…'
          : s.overridden
            ? 'Set on this fleet'
            : 'Inherited from a parent fleet'}
      </span>
      {s?.overridden && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void change(null)}
          className="text-xs font-bold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Use parent setting
        </button>
      )}
      {error && (
        <p role="alert" className="basis-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
