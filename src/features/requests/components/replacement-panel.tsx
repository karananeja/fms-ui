import type { DriverRequest, ReplacementCandidate } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { inputClass } from '@/features/auth/components/text-field';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { requestSuggestions } from '../api/requests-api';
import type { ActionInput } from '../api/requests-api';
import { autoAssigned } from '../lib/request-model';

export interface VehicleHit {
  vehicleId: string;
  regno: string;
}

export type VehicleSearch = (q: string) => Promise<VehicleHit[]>;

/** Reg-no search from the live worker (`live.view`; it holds every vehicle in scope). */
const workerSearch: VehicleSearch = async (q) =>
  (await liveTrackingStore.suggest(q, 'regno')).map((s) => ({
    vehicleId: s.vehicleId,
    regno: s.regno,
  }));

const km = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)} km`;

/**
 * F14-R3: replacement candidates (top 5: reg no, distance, SOC, range, status). **Approve**
 * assigns the suggestion; **Override** picks another candidate or a searched vehicle (the server
 * checks it and its reason shows on failure); **waiting** says we'll notify. `preview` (the
 * "Suggest replacement" shortcut on a breakdown) lists candidates without actions.
 */
export function ReplacementPanel({
  request: r,
  onAct,
  pending,
  preview,
  regnoOf,
  loadSuggestions = requestSuggestions,
  search = workerSearch,
  replacementRequestId,
}: {
  request: DriverRequest;
  onAct: (input: ActionInput) => void;
  pending?: boolean;
  preview?: boolean;
  regnoOf?: (vehicleId: string) => string | null;
  loadSuggestions?: (id: string, opts: { signal: AbortSignal }) => Promise<ReplacementCandidate[]>;
  search?: VehicleSearch;
  /** Preview: the driver's open replacement request, where the operator can approve. */
  replacementRequestId?: string | null;
}) {
  const [overriding, setOverriding] = useState(false);
  const [picked, setPicked] = useState<VehicleHit | null>(null);
  const terminal = ['assigned', 'resolved', 'closed', 'rejected', 'approved'].includes(r.status);
  const res = useResource(
    (signal) => (terminal ? Promise.resolve([]) : loadSuggestions(r.id, { signal })),
    `${r.id}:${r.status}:${r.updatedAt}`,
  );
  const candidates = res.data ?? [];

  if (r.status === 'assigned') {
    const id = r.replacement?.assignedVehicleId ?? '';
    return (
      <Section>
        <p className="text-sm" data-testid="replacement-assigned">
          <span className="text-text-muted">Replacement </span>
          <Link
            to="/live-tracking"
            search={{ vehicle: id }}
            className="font-extrabold text-accent hover:underline"
          >
            {regnoOf?.(id) ?? id}
          </Link>
          {autoAssigned(r) && (
            <span className="ml-2 text-xs text-text-muted">Assigned automatically</span>
          )}
        </p>
      </Section>
    );
  }
  if (terminal) return null;

  const suggestedId = r.replacement?.suggestedVehicleId;
  const canApprove = !preview && r.status === 'suggested' && !!suggestedId;
  const canOverride = !preview && ['open', 'waiting', 'suggested'].includes(r.status);

  return (
    <Section>
      {r.status === 'waiting' && (
        <p role="status" className="mb-2 text-sm text-warn" data-testid="replacement-waiting">
          No eligible vehicle yet. We&apos;ll notify you.
        </p>
      )}
      {res.error ? (
        <p role="alert" className="text-xs text-danger">
          {errorText(res.error)}
        </p>
      ) : res.loading && !res.data ? (
        <p className="text-xs text-text-muted">Finding vehicles…</p>
      ) : candidates.length === 0 ? (
        r.status !== 'waiting' && (
          <p className="text-sm text-text-muted">No eligible vehicle right now.</p>
        )
      ) : (
        <CandidateList
          candidates={candidates}
          suggestedId={suggestedId}
          selectable={overriding}
          picked={picked?.vehicleId ?? null}
          onPick={(c) => setPicked({ vehicleId: c.vehicleId, regno: c.regno })}
        />
      )}
      {preview && (
        <p className="mt-2 text-xs text-text-muted">
          {replacementRequestId ? (
            <>
              The driver has a replacement request.{' '}
              <Link
                to="/requests/$requestId"
                params={{ requestId: replacementRequestId }}
                className="font-bold text-accent hover:underline"
              >
                Open it to approve
              </Link>
            </>
          ) : (
            'Approve a vehicle once the driver asks for a replacement.'
          )}
        </p>
      )}
      {overriding && <OverrideSearch search={search} onPick={setPicked} picked={picked} />}
      {(canApprove || canOverride) && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {overriding ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOverriding(false);
                  setPicked(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!picked || pending}
                onClick={() => picked && onAct({ action: 'override', vehicleId: picked.vehicleId })}
              >
                {picked ? `Assign ${picked.regno}` : 'Pick a vehicle'}
              </Button>
            </>
          ) : (
            <>
              {canOverride && (
                <Button variant="outline" size="sm" onClick={() => setOverriding(true)}>
                  Override
                </Button>
              )}
              {canApprove && (
                <Button size="sm" disabled={pending} onClick={() => onAct({ action: 'approve' })}>
                  Approve
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Replacement"
      data-testid="replacement-panel"
      className="rounded-tile border border-tile-border bg-tile p-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-black tracking-[0.12em] text-text-muted uppercase">
        <Sparkles aria-hidden className="size-3.5" /> Replacement
      </h3>
      {children}
    </section>
  );
}

function CandidateList({
  candidates,
  suggestedId,
  selectable,
  picked,
  onPick,
}: {
  candidates: readonly ReplacementCandidate[];
  suggestedId?: string;
  selectable: boolean;
  picked: string | null;
  onPick: (c: ReplacementCandidate) => void;
}) {
  return (
    <ul aria-label="Replacement candidates" className="flex flex-col gap-1">
      {candidates.map((c) => {
        const suggested = c.vehicleId === suggestedId;
        const body = (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-extrabold">{c.regno}</span>
              {suggested && (
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-black tracking-[0.08em] text-accent uppercase">
                  Suggested
                </span>
              )}
            </span>
            <span className="text-xs text-text-muted tabular-nums">
              {km(c.distanceKm)} away · SOC {c.soc === null ? '—' : `${Math.round(c.soc)}%`} ·{' '}
              {Math.round(c.rangeKm)} km range · <span className="capitalize">{c.status}</span>
            </span>
          </span>
        );
        return (
          <li key={c.vehicleId} data-testid="candidate">
            {selectable ? (
              <button
                type="button"
                aria-pressed={picked === c.vehicleId}
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent-soft"
              >
                {body}
              </button>
            ) : (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  suggested && 'bg-accent-soft/50',
                )}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Override: search any vehicle by reg no (the server checks it's free and in scope). */
function OverrideSearch({
  search,
  onPick,
  picked,
}: {
  search: VehicleSearch;
  onPick: (v: VehicleHit) => void;
  picked: VehicleHit | null;
}) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<{ q: string; hits: VehicleHit[] }>({ q: '', hits: [] });
  const text = q.trim();
  const hits = text.length >= 2 && result.q === text ? result.hits : [];
  useEffect(() => {
    if (text.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void search(text).then(
        (h) => live && setResult({ q: text, hits: h.slice(0, 6) }),
        () => live && setResult({ q: text, hits: [] }),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, search]);

  return (
    <div className="mt-3">
      <label className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a vehicle by reg no"
          aria-label="Search a replacement vehicle"
          className={cn(inputClass, 'h-10 pl-9')}
        />
      </label>
      {hits.length > 0 && (
        <ul aria-label="Vehicle search results" className="mt-1 flex flex-col gap-0.5">
          {hits.map((h) => (
            <li key={h.vehicleId}>
              <button
                type="button"
                aria-pressed={picked?.vehicleId === h.vehicleId}
                onClick={() => onPick(h)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm font-extrabold outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent-soft"
              >
                {h.regno}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
