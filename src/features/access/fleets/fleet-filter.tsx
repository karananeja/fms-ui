import type { Fleet } from '@shared/contract/index.ts';
import { ChevronDown, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { FleetPicker } from './fleet-picker';

/** F03 fleet picker in a popover (the inline tree is too tall for the toolbar). */
export function FleetFilter({
  fleets,
  value,
  onChange,
  label,
}: {
  fleets: readonly Fleet[];
  value: string | null;
  onChange: (fleetId: string | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="outline" className="h-10 max-w-56" aria-label="Filter by fleet">
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-50 w-[min(320px,calc(100vw-32px))] rounded-tile border border-glass-border bg-surface-solid shadow-[0_16px_40px_var(--shadow)]"
          >
            <FleetPicker
              mode="single"
              aria-label="Fleet filter"
              placeholder="All fleets"
              fleets={fleets}
              value={value}
              onChange={(id) => {
                onChange(id);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear fleet filter"
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      )}
    </span>
  );
}

