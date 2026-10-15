import { CloudOff, LinkIcon, TimerOff } from 'lucide-react';

export type UnavailableKind = 'gone' | 'not-found' | 'error';

const COPY: Record<UnavailableKind, { title: string; body: string; Icon: typeof TimerOff }> = {
  gone: {
    title: 'This link is no longer available',
    body: 'It has expired or was turned off by the person who shared it. Ask them for a new link if you still need to follow this vehicle.',
    Icon: TimerOff,
  },
  'not-found': {
    title: 'Link not found',
    body: 'Check that the address was copied in full, or ask the person who shared it for a new link.',
    Icon: LinkIcon,
  },
  error: {
    title: "This link can't be opened right now",
    body: 'The live location service is not reachable. Try again in a moment.',
    Icon: CloudOff,
  },
};

/** F10-R8: calm, centred end states for the public page. No links into the app. */
export function ShareUnavailable({
  kind,
  onRetry,
}: {
  kind: UnavailableKind;
  onRetry?: () => void;
}) {
  const { title, body, Icon } = COPY[kind];
  return (
    <main
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="share-unavailable"
      data-kind={kind}
    >
      <span className="grid size-16 place-items-center rounded-full border border-glass-border bg-glass shadow-[0_8px_24px_var(--shadow)]">
        <Icon className="size-7 text-text-muted" aria-hidden />
      </span>
      <h1 className="font-display text-xl font-black">{title}</h1>
      <p className="max-w-sm text-sm text-text-muted">{body}</p>
      {kind === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 h-10 rounded-full bg-linear-135 from-accent to-accent-2 px-5 text-sm font-semibold text-accent-ink"
        >
          Try again
        </button>
      )}
    </main>
  );
}

/** "Shared via FMS" mark (no link into the app). */
export function SharedViaMark({ className }: { className?: string }) {
  return (
    <p className={className} data-testid="shared-via">
      <span className="text-text-faint">Shared via</span>{' '}
      <span className="bg-linear-135 from-[var(--accent-text)] to-[var(--accent-2)] bg-clip-text font-semibold text-transparent">
        FMS
      </span>
    </p>
  );
}
