import type { ShareLink } from '@shared/contract/index.ts';
import { ChevronDown, Copy, Link2Off } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatRelativeTime } from '@/features/access/lib/access-format';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { formatExpiryIst } from '../lib/share-expiry';
import {
  canRevokeLink,
  optionChips,
  shareLinkStatus,
  type ShareLinkStatus,
} from '../lib/share-link-model';
import { copyText, fullShareUrl } from './use-share-links';

/* F10-R6/R7 building blocks, shared by the Share dialog's Links tab and `/admin/share-links`. */

const STATUS: Record<ShareLinkStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--ok)' },
  expired: { label: 'Expired', color: 'var(--text-muted)' },
  revoked: { label: 'Revoked', color: 'var(--danger)' },
};

export function ShareStatusPill({ status }: { status: ShareLinkStatus }) {
  return (
    <TintPill color={STATUS[status].color} data-status={status}>
      {STATUS[status].label}
    </TintPill>
  );
}

export function OptionChips({ link, className }: { link: ShareLink; className?: string }) {
  return (
    <ul aria-label="Shared data" className={cn('flex flex-wrap gap-1', className)}>
      {optionChips(link).map((c) => (
        <li
          key={c}
          className="rounded-full border border-tile-border bg-tile px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase"
        >
          {c}
        </li>
      ))}
    </ul>
  );
}

/** "in 5 h" / "3 d ago" over the IST time. */
export function ExpiryWhen({ at, now, prefix }: { at: number; now: number; prefix?: string }) {
  return (
    <time dateTime={new Date(at).toISOString()} className="block whitespace-nowrap">
      {prefix}
      {formatRelativeTime(at, now)}
      <span className="block text-[11px] text-text-faint">{formatExpiryIst(at)}</span>
    </time>
  );
}

export function CopyLinkButton({ link, label = 'Copy link' }: { link: ShareLink; label?: string }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => void copyText(fullShareUrl(link))}
    >
      <Copy />
    </Button>
  );
}

export function RevokeButton({
  onClick,
  disabled,
  label = 'Revoke link',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="hover:text-danger"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Link2Off />
    </Button>
  );
}

function Row({
  link,
  now,
  creator,
  revocable,
  onRevoke,
}: {
  link: ShareLink;
  now: number;
  creator?: ReactNode;
  revocable: boolean;
  onRevoke: () => void;
}) {
  const status = shareLinkStatus(link, now);
  const active = status === 'active';
  return (
    <li
      data-link-id={link.id}
      data-status={status}
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-tile)] border border-tile-border bg-tile p-3',
        !active && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <ShareStatusPill status={status} />
        <div className="min-w-0 flex-1 text-xs">
          <ExpiryWhen
            at={link.expiresAt}
            now={now}
            prefix={active ? 'Expires ' : status === 'expired' ? 'Expired ' : 'Was to expire '}
          />
        </div>
        <div className="flex shrink-0 gap-0.5">
          <CopyLinkButton link={link} />
          {active && revocable && <RevokeButton onClick={onRevoke} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OptionChips link={link} />
        {creator && <span className="text-[11px] text-text-muted">by {creator}</span>}
      </div>
    </li>
  );
}

/**
 * F10-R6: links newest first; active ones on top, expired/revoked dimmed and collapsed under
 * "Show N inactive". Revoke shows on active links you created or, with `share.revoke`, any.
 */
export function ShareLinkList({
  links,
  now,
  meId,
  canRevokeAny,
  creatorName,
  onRevoke,
}: {
  links: readonly ShareLink[];
  now: number;
  meId: string | undefined;
  canRevokeAny: boolean;
  /** Shown as "by …" (with `share.revoke` only). */
  creatorName?: (userId: string) => string;
  onRevoke: (link: ShareLink) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const active = links.filter((l) => shareLinkStatus(l, now) === 'active');
  const inactive = links.filter((l) => shareLinkStatus(l, now) !== 'active');
  const row = (l: ShareLink) => (
    <Row
      key={l.id}
      link={l}
      now={now}
      creator={canRevokeAny && creatorName ? creatorName(l.createdBy) : undefined}
      revocable={canRevokeLink(l, meId, canRevokeAny)}
      onRevoke={() => onRevoke(l)}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      {active.length > 0 ? (
        <ul aria-label="Active links" className="flex flex-col gap-2">
          {active.map(row)}
        </ul>
      ) : (
        <p className="rounded-tile border border-tile-border bg-tile p-4 text-center text-sm text-text-muted">
          No active links for this vehicle.
        </p>
      )}
      {inactive.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((v) => !v)}
            className="flex items-center gap-1.5 self-start rounded-md px-1 py-1 text-xs font-semibold tracking-[0.08em] text-text-muted uppercase outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden
              className={cn('size-3.5 transition-transform', showInactive && 'rotate-180')}
            />
            {showInactive ? 'Hide' : 'Show'} {inactive.length} inactive
          </button>
          {showInactive && (
            <ul aria-label="Inactive links" className="flex flex-col gap-2">
              {inactive.map(row)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
