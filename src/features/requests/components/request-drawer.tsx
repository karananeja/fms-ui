import type { DriverRequest, RequestAction } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { SidePanel } from '@/features/access/components/admin-ui';
import { errorText, formatIstShort, formatRelativeTime } from '@/features/access/lib/access-format';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { telHref } from '@/features/drivers/lib/driver-format';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { Button } from '@/shared/ui/button';
import { getRequest, requestAction, type ActionInput } from '../api/requests-api';
import {
  ACTION_LABEL,
  availableActions,
  isOpenRequest,
  REASON_LABEL,
  STATUS_META,
  timelineText,
  TYPE_LABEL,
} from '../lib/request-model';
import { NoteField } from './note-field';
import { ReplacementPanel, type VehicleSearch } from './replacement-panel';
import { RequestMiniMap } from './request-mini-map';
import { RsaDispatchForm } from './rsa-dispatch-form';

export interface DrawerDriver {
  name: string;
  phone: string;
}

export interface RequestDrawerProps {
  request: DriverRequest | null;
  /** True while the request is being fetched (deep link before the desk has it). */
  loading?: boolean;
  error?: unknown;
  onClose: () => void;
  /** After an action or a refresh: the latest copy (the desk store merges it). */
  onUpdated: (r: DriverRequest) => void;
  regnoOf: (vehicleId: string) => string | null;
  driver: DrawerDriver | null | undefined;
  fleetName?: string;
  /** The driver's open replacement request (the breakdown shortcut links to it). */
  replacementRequestId?: string | null;
  act?: (id: string, input: ActionInput) => Promise<DriverRequest>;
  refresh?: (id: string) => Promise<DriverRequest>;
  /** Replacement panel overrides (tests). */
  loadSuggestions?: Parameters<typeof ReplacementPanel>[0]['loadSuggestions'];
  search?: VehicleSearch;
}

/** Simple actions here (approve / override live in the replacement panel, dispatch in its form). */
const FOOTER_ACTIONS: readonly RequestAction[] = ['acknowledge', 'resolve', 'close', 'reject'];

/**
 * F14-R2: the request drawer (routed at `/requests/$requestId`, over the desk): details, driver,
 * location snippet, timeline and the actions valid now. A 409 means the request changed
 * meanwhile: the drawer refreshes it and says so (or shows the server's reason for a vehicle).
 */
export function RequestDrawer(props: RequestDrawerProps) {
  const { request: r, loading, error, onClose, regnoOf } = props;
  const regno = r ? (regnoOf(r.vehicleId) ?? r.vehicleId) : '';
  return (
    <SidePanel
      open
      onOpenChange={(open) => !open && onClose()}
      title={r ? `${TYPE_LABEL[r.type]} · ${regno}` : loading ? 'Loading…' : 'Request'}
      description={r ? `Request ${r.id}` : undefined}
      footer={r && <DrawerActions key={`${r.id}:${r.status}`} {...props} request={r} />}
    >
      {r ? (
        <DrawerBody {...props} request={r} />
      ) : (
        <p className="text-sm text-text-muted" role={error ? 'alert' : undefined}>
          {error ? errorText(error) : 'Loading…'}
        </p>
      )}
    </SidePanel>
  );
}

function useAct({
  request: r,
  onUpdated,
  act = requestAction,
  refresh = getRequest,
}: RequestDrawerProps & { request: DriverRequest }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (input: ActionInput): Promise<boolean> => {
    setPending(true);
    setMessage(null);
    try {
      onUpdated(await act(r.id, input));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMessage(
          err.code === 'invalid_transition'
            ? 'This request changed meanwhile. It has been refreshed.'
            : err.message,
        );
        await refresh(r.id).then(onUpdated, () => {});
      } else setMessage(errorText(err));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, message, run };
}

/** The footer: the valid simple actions; one opens a note + confirm; Dispatch opens the form. */
function DrawerActions(props: RequestDrawerProps & { request: DriverRequest }) {
  const { request: r } = props;
  const { pending, message, run } = useAct(props);
  const [chosen, setChosen] = useState<RequestAction | null>(null);
  const [note, setNote] = useState('');
  const valid = availableActions(r);
  const simple = FOOTER_ACTIONS.filter((a) => valid.includes(a));
  const canDispatch = valid.includes('dispatch');

  const status = message && (
    <p role="alert" className="basis-full text-xs text-danger" data-testid="action-error">
      {message}
    </p>
  );
  if (chosen === 'dispatch') {
    return (
      <div className="basis-full">
        {status}
        <RsaDispatchForm
          pending={pending}
          onCancel={() => setChosen(null)}
          onSubmit={(input) =>
            void run({ action: 'dispatch', ...input }).then((ok) => ok && setChosen(null))
          }
        />
      </div>
    );
  }
  if (chosen) {
    return (
      <div className="basis-full">
        {status}
        <NoteField id="action-note" value={note} onChange={setNote} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setChosen(null)}>
            Cancel
          </Button>
          <Button
            variant={chosen === 'reject' ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() =>
              void run({ action: chosen, ...(note.trim() ? { note: note.trim() } : {}) }).then(
                (ok) => ok && setChosen(null),
              )
            }
          >
            Confirm {ACTION_LABEL[chosen].toLowerCase()}
          </Button>
        </div>
      </div>
    );
  }
  if (!simple.length && !canDispatch) return status || null;
  return (
    <>
      {status}
      {simple.map((a) => (
        <Button
          key={a}
          data-testid={`action-${a}`}
          variant={a === 'reject' || a === 'close' ? 'outline' : 'default'}
          onClick={() => {
            setNote('');
            setChosen(a);
          }}
        >
          {ACTION_LABEL[a]}
        </Button>
      ))}
      {canDispatch && (
        <Button onClick={() => setChosen('dispatch')}>{ACTION_LABEL.dispatch}</Button>
      )}
    </>
  );
}

function DrawerBody(props: RequestDrawerProps & { request: DriverRequest }) {
  const { request: r, regnoOf, driver, fleetName, replacementRequestId } = props;
  const me = useSession(selectMe);
  const now = useNow(30_000);
  const { pending, message, run } = useAct(props);
  const [suggest, setSuggest] = useState(false);
  const meta = STATUS_META[r.status];
  const showReplacement = r.type === 'replacement' || (r.type === 'breakdown' && suggest);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-tile border border-tile-border bg-tile p-3">
        <div className="mb-2 flex items-center gap-2">
          <TintPill color={meta.color} data-status={r.status}>
            {meta.label}
          </TintPill>
          <span className="ml-auto text-xs text-text-muted" title={formatIstShort(r.createdAt)}>
            Reported {formatRelativeTime(r.createdAt, now)}
          </span>
        </div>
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-text-muted">Vehicle</dt>
          <dd>
            <Link
              to="/live-tracking"
              search={{ vehicle: r.vehicleId }}
              className="font-semibold text-accent hover:underline"
            >
              {regnoOf(r.vehicleId) ?? r.vehicleId}
            </Link>
          </dd>
          {r.reason && (
            <>
              <dt className="text-text-muted">Reason</dt>
              <dd data-testid="request-reason">{REASON_LABEL[r.reason]}</dd>
            </>
          )}
          {r.note && (
            <>
              <dt className="text-text-muted">Note</dt>
              <dd className="break-words">{r.note}</dd>
            </>
          )}
          {fleetName && (
            <>
              <dt className="text-text-muted">Fleet</dt>
              <dd>{fleetName}</dd>
            </>
          )}
          <dt className="text-text-muted">Reported</dt>
          <dd className="tabular-nums">{formatIstShort(r.createdAt)}</dd>
          {r.rsa && (
            <>
              <dt className="text-text-muted">RSA</dt>
              <dd data-testid="rsa-details">
                {r.rsa.assignee} · ETA {r.rsa.etaMinutes} min
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="flex items-center gap-3 rounded-tile border border-tile-border bg-tile p-3">
        <UserRound aria-hidden className="size-5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" data-testid="request-driver">
            {driver === undefined ? 'Loading…' : (driver?.name ?? 'Driver')}
          </p>
          {driver && <p className="truncate text-xs text-text-muted">{driver.phone}</p>}
        </div>
        {driver && (
          <Button asChild variant="outline" size="sm">
            <a href={telHref(driver.phone)} aria-label={`Call ${driver.name}`}>
              <Phone aria-hidden /> Call
            </a>
          </Button>
        )}
      </section>

      <RequestMiniMap location={r.location} />

      {message && (
        <p role="alert" className="text-xs text-danger" data-testid="replacement-error">
          {message}
        </p>
      )}
      {r.type === 'breakdown' && isOpenRequest(r) && !suggest && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setSuggest(true)}>
          Suggest replacement
        </Button>
      )}
      {showReplacement && (
        <ReplacementPanel
          request={r}
          preview={r.type !== 'replacement'}
          pending={pending}
          onAct={(input) => void run(input)}
          regnoOf={regnoOf}
          replacementRequestId={replacementRequestId}
          {...(props.loadSuggestions ? { loadSuggestions: props.loadSuggestions } : {})}
          {...(props.search ? { search: props.search } : {})}
        />
      )}

      <section aria-label="Timeline">
        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
          Timeline
        </h3>
        <ol className="flex flex-col gap-2 border-l border-tile-border pl-3" data-testid="timeline">
          {r.timeline.map((t, i) => {
            const { title, by } = timelineText(r, i, me?.user.id ?? null);
            return (
              <li key={`${t.at}-${i}`} className="relative text-sm">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[17px] size-2 rounded-full"
                  style={{ background: STATUS_META[t.status].color }}
                />
                <span className="font-semibold">{title}</span>
                <span className="text-xs text-text-muted">
                  {' '}
                  · {by} · {formatIstShort(t.at)}
                </span>
                {t.note && <p className="text-xs break-words text-text-muted">{t.note}</p>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
