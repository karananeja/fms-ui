import type { PublicShare } from '@shared/contract/share-links.ts';
import { ChevronDown, Clock3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { getPublicShare } from './public-share-api';
import { PublicMetrics } from './public-metrics';
import { PublicShareMap } from './public-share-map';
import { formatAge, formatIstShort, formatTimeLeft, STALE_AFTER_MS } from './share-format';
import type { MapPadding, ShareMapView } from './share-map-controller';
import { preloadShareMap } from './share-map-loader';
import type { ShareSocketOptions } from './share-socket';
import { SharedViaMark, ShareUnavailable, type UnavailableKind } from './share-unavailable';
import { useShareLive, type ShareLive } from './use-share-live';

type PageState =
  { kind: 'loading' } | { kind: 'ok'; share: PublicShare } | { kind: UnavailableKind };

const MAX_TIMEOUT = 2 ** 31 - 1;

/** True once `expiresAt` has passed on the (server-corrected) clock. */
function useExpired(expiresAt: number, offsetMs: number): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const left = expiresAt - (Date.now() + offsetMs);
      if (left <= 0) setExpired(true);
      else timer = setTimeout(arm, Math.min(left, MAX_TIMEOUT));
    };
    timer = setTimeout(arm, 0);
    return () => clearTimeout(timer);
  }, [expiresAt, offsetMs]);
  return expired;
}

const HEADER_PX = 56;
const samePadding = (a: MapPadding, b: MapPadding) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/** Map padding for the area the header and the metrics card cover (desktop: left; mobile: bottom). */
function useCardPadding(card: RefObject<HTMLElement | null>, desktop: boolean): MapPadding {
  const [padding, setPadding] = useState<MapPadding>({
    top: HEADER_PX,
    right: 0,
    bottom: 0,
    left: 0,
  });
  useEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = desktop
        ? { top: HEADER_PX, right: 0, bottom: 0, left: Math.round(r.right) }
        : { top: HEADER_PX, right: 0, bottom: Math.round(window.innerHeight - r.top), left: 0 };
      setPadding((p) => (samePadding(p, next) ? p : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [card, desktop]);
  return padding;
}

function LivePill({ live, now }: { live: ShareLive; now: number }) {
  const gps = live.latest?.gpstime;
  let label: string;
  let on = false;
  if (live.connection === 'reconnecting') label = 'Reconnecting';
  else if (gps === undefined) label = 'Connecting';
  else if (now - gps <= STALE_AFTER_MS) {
    label = 'Live';
    on = true;
  } else label = `Last update ${formatAge(gps, now)}`;
  return (
    <span
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-extrabold tracking-[0.12em] uppercase',
        on
          ? 'border-transparent bg-accent-soft text-[var(--accent-text)]'
          : 'border-glass-border bg-tile text-text-muted',
      )}
      data-testid="share-live-pill"
      data-live={on}
    >
      <span
        className={cn('size-2 rounded-full', on ? 'fms-pulse bg-accent' : 'bg-warn')}
        aria-hidden
      />
      {label}
    </span>
  );
}

function Expiry({ expiresAt, now }: { expiresAt: number; now: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-text-muted" data-testid="share-expiry">
      <Clock3 className="size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-extrabold text-text">Link expires</span>{' '}
        {formatTimeLeft(expiresAt, now)} · {formatIstShort(expiresAt)}
      </span>
    </p>
  );
}

function LiveShare({
  token,
  share,
  onUnavailable,
  socketOptions,
}: {
  token: string;
  share: PublicShare;
  onUnavailable: (kind: UnavailableKind) => void;
  socketOptions?: Partial<ShareSocketOptions>;
}) {
  const live = useShareLive(token, share, socketOptions);
  const expired = useExpired(share.expiresAt, live.serverOffsetMs);
  const now = useNow(10_000) + live.serverOffsetMs;
  const desktop = useMediaQuery('(min-width: 1024px)');
  const card = useRef<HTMLElement>(null);
  const padding = useCardPadding(card, desktop);
  const [open, setOpen] = useState(true);
  const { vehicle, options } = share;

  useEffect(() => {
    const c = live.connection;
    if (expired || c === 'gone') onUnavailable('gone');
    else if (c === 'not-found') onUnavailable('not-found');
    else if (c === 'error') onUnavailable('error');
  }, [expired, live.connection, onUnavailable]);

  useEffect(() => {
    document.title = `${vehicle.regno} · Live location`;
  }, [vehicle.regno]);

  const { latest, moving, trail } = live;
  const view = useMemo<ShareMapView>(
    () => ({
      position: latest ? [latest.longitude, latest.latitude] : null,
      heading: latest?.heading ?? 0,
      moving: moving ?? false,
      trail: trail ? trail.map((p) => [p[0], p[1]]) : null,
    }),
    [latest, moving, trail],
  );

  return (
    <>
      <div className="absolute inset-0">
        <PublicShareMap view={view} padding={padding} />
      </div>

      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-3 border-x-0 border-t-0 px-4 shadow-[0_4px_20px_var(--shadow)] glass">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-135 from-accent to-accent-2 shadow-[0_0_16px_var(--accent-glow)]"
          aria-hidden
        >
          <span className="size-2.5 rounded-full bg-[var(--marker-ring)]" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-base font-black" data-testid="share-regno">
            {vehicle.regno}
          </h1>
          <p
            className="truncate text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
            data-testid="share-model"
          >
            {vehicle.make} · {vehicle.model}
          </p>
        </div>
        <LivePill live={live} now={now} />
      </header>

      <aside
        ref={card}
        data-testid="share-card"
        className={cn(
          'absolute z-10 flex flex-col overflow-hidden shadow-[0_12px_32px_var(--shadow)] glass',
          desktop
            ? 'top-[72px] left-4 max-h-[calc(100%-88px)] w-[340px] rounded-panel'
            : 'inset-x-2 bottom-2 max-h-[55%] rounded-panel',
        )}
      >
        <div className="flex items-center gap-2 border-b border-glass-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <Expiry expiresAt={share.expiresAt} now={now} />
          </div>
          {!desktop && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="share-metrics"
              aria-label={open ? 'Hide details' : 'Show details'}
              data-testid="share-card-toggle"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-glass-border bg-tile"
            >
              <ChevronDown
                className={cn('size-4 transition-transform', !open && 'rotate-180')}
                aria-hidden
              />
            </button>
          )}
        </div>
        {(desktop || open) && (
          <div id="share-metrics" className="overflow-y-auto px-4 py-4">
            <PublicMetrics show={options.show} latest={latest} moving={moving} now={now} />
            {!desktop && <SharedViaMark className="mt-4 text-center text-xs" />}
          </div>
        )}
      </aside>

      {desktop && <SharedViaMark className="absolute bottom-3 left-4 z-10 text-xs" />}
    </>
  );
}

export interface PublicSharePageProps {
  token: string;
  /** Test seam for the share socket (fake `WebSocket`, backoff). */
  socketOptions?: Partial<ShareSocketOptions>;
}

/**
 * F10-R8…R13: `/share/$token`. No sign-in, no app shell, no session probe and no fleet worker;
 * light tokens are scoped to this page (`data-theme="share-light"`, D-090).
 */
export function PublicSharePage({ token, socketOptions }: PublicSharePageProps) {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    if (typeof WebGLRenderingContext !== 'undefined') void preloadShareMap().catch(() => {});
    getPublicShare(token, abort.signal).then(
      (r) => setState(r.kind === 'ok' ? r : { kind: r.kind }),
      () => {
        if (!abort.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => abort.abort();
  }, [token, attempt]);

  const [unavailable, setUnavailable] = useState<UnavailableKind | null>(null);
  const kind = unavailable ?? (state.kind === 'ok' || state.kind === 'loading' ? null : state.kind);

  useEffect(() => {
    if (kind === 'gone') document.title = 'Link no longer available';
    else if (kind === 'not-found') document.title = 'Link not found';
  }, [kind]);

  return (
    <div
      data-theme="share-light"
      data-testid="share-page"
      className="relative h-dvh w-full overflow-hidden bg-bg font-sans text-text"
    >
      {kind ? (
        <>
          <ShareUnavailable
            kind={kind}
            onRetry={() => {
              setUnavailable(null);
              setState({ kind: 'loading' });
              setAttempt((a) => a + 1);
            }}
          />
          <SharedViaMark className="absolute inset-x-0 bottom-4 text-center text-xs" />
        </>
      ) : state.kind === 'ok' ? (
        <LiveShare
          token={token}
          share={state.share}
          onUnavailable={setUnavailable}
          socketOptions={socketOptions}
        />
      ) : (
        <div className="grid h-full place-items-center" data-testid="share-loading">
          <span className="size-3 animate-pulse rounded-full bg-accent" aria-label="Loading" />
        </div>
      )}
    </div>
  );
}
