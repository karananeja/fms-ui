import { LocateFixed, X } from 'lucide-react';
import { memo } from 'react';
import { Button } from '@/shared/ui/button';
import {
  TONE_COLOR,
  type DetailsHeader as Header,
  type TimeCell,
} from '../lib/vehicle-details-model';
import { CopyButton } from './details-ui';
import { StatusPill } from './status-pill';

function Time({ label, cell }: { label: string; cell: TimeCell }) {
  return (
    <span
      className="flex items-center gap-1.5 text-sm"
      data-testid={`details-${label.toLowerCase()}`}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[cell.tone] }}
        data-tone={cell.tone}
        aria-hidden
      />
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums" data-testid={`details-${label.toLowerCase()}-time`}>
        {cell.text}
      </span>
    </span>
  );
}

export const DetailsHeader = memo(function DetailsHeader({
  header,
  onLocate,
  onClose,
}: {
  header: Header;
  onLocate: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex flex-col gap-2.5 px-5 pt-5 pb-4">
      <div className="flex items-center gap-1">
        <h2
          id="vehicle-details-title"
          className="min-w-0 truncate font-display text-2xl font-bold tracking-wide"
          data-testid="details-regno"
        >
          {header.regno}
        </h2>
        <CopyButton value={header.regno} label="Copy registration number" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Locate on map"
          className="text-text-muted hover:text-text"
          onClick={onLocate}
        >
          <LocateFixed />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close details"
          className="ml-auto text-text-muted hover:text-text"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {header.subtitle && <span className="text-sm text-text-muted">{header.subtitle}</span>}
        {header.fuel && (
          <span className="rounded-md border border-ok/50 px-2 py-px font-display text-xs font-bold text-ok">
            {header.fuel}
          </span>
        )}
        <span className="ml-auto" data-testid="details-status">
          {header.status && <StatusPill status={header.status} />}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Time label="GPS" cell={header.gps} />
        <Time label="CAN" cell={header.can} />
      </div>
    </header>
  );
});
