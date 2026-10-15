import { Crosshair, X } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  TONE_COLOR,
  type Badges,
  type DetailsHeader,
  type TimeCell,
} from '../lib/vehicle-details-model';
import { CopyButton, IconButton } from './details-ui';
import { StatusPill } from './status-pill';
import { VehicleIllustration } from './vehicle-illustration';

function Fresh({ label, cell }: { label: string; cell: TimeCell }) {
  const id = label.toLowerCase();
  return (
    <span className="flex items-center gap-1.5" title={cell.abs} data-testid={`details-${id}`}>
      <span
        className="size-2 rounded-full"
        style={{ background: TONE_COLOR[cell.tone] }}
        data-tone={cell.tone}
        aria-hidden
      />
      {label}
      <b
        className="font-semibold text-text uppercase"
        data-testid={`details-${id}-rel`}
        data-abs={cell.abs}
      >
        {cell.rel}
      </b>
    </span>
  );
}

function SignalBars({ bars }: { bars: number }) {
  return (
    <span
      className="flex h-3.5 items-end gap-0.5"
      aria-label={`${bars} of 4 bars`}
      data-bars={bars}
    >
      {[4, 7, 10, 14].map((h, k) => (
        <i
          key={h}
          className={cn('w-[3px] rounded-[1px]', k < bars ? 'bg-ok' : 'bg-tile-border')}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

const badge =
  'glass absolute top-[18px] rounded-[10px] px-2 py-1.5 text-[10px] font-semibold text-text-muted';

/** Fixed hero: regno + actions, status, illustration with signal/GPS badges, freshness (F07-R6). */
export const DetailsHero = memo(function DetailsHero({
  header,
  badges,
  compact,
  onLocate,
  onClose,
}: {
  header: DetailsHeader;
  badges: Badges | null;
  /** Mobile: hides the absolute time. */
  compact?: boolean;
  onLocate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative bg-[radial-gradient(ellipse_at_70%_80%,var(--accent-soft),transparent_60%)] px-4 pt-4">
      <div className="flex items-center gap-1.5">
        <h2
          id="vehicle-details-title"
          className="min-w-0 flex-1 truncate text-xl font-semibold tracking-[0.04em]"
          data-testid="details-regno"
        >
          {header.regno}
        </h2>
        <CopyButton value={header.regno} label="Copy registration number" />
        <IconButton label="Locate on map" onClick={onLocate}>
          <Crosshair />
        </IconButton>
        <IconButton label="Close details" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span data-testid="details-status">
          {header.status && <StatusPill status={header.status} />}
        </span>
        {header.subtitle && <span className="text-xs text-text-muted">{header.subtitle}</span>}
        {header.fuel && (
          <span className="rounded-md border border-tile-border px-1.5 py-px text-[10px] font-semibold text-text-muted">
            {header.fuel}
          </span>
        )}
      </div>
      <div className="relative mt-1 h-32">
        <VehicleIllustration
          kind={header.illustration}
          className="absolute bottom-1 left-1/2 w-[230px] -translate-x-1/2"
        />
        {badges && (
          <>
            <div className={cn(badge, 'left-0')} data-testid="badge-signal">
              SIGNAL
              <b className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                {badges.signal}
                <SignalBars bars={badges.bars} />
              </b>
            </div>
            <div className={cn(badge, 'right-0 text-right')} data-testid="badge-gps">
              GPS FIX
              <b
                className="block text-[13px] font-semibold"
                style={{ color: badges.fixTone === 'ok' ? undefined : TONE_COLOR[badges.fixTone] }}
              >
                {badges.fix}
              </b>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3.5 pt-2.5 pb-3 text-[11px] text-text-muted">
        <Fresh label="GPS" cell={header.gps} />
        <Fresh label="CAN" cell={header.can} />
        {!compact && (
          <span className="ml-auto" data-testid="details-latest">
            {header.latest.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
});
