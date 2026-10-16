import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/shared/lib/utils';
import { Calendar } from './calendar';

/** `YYYY-MM-DD` of a calendar day picked in the grid (the grid works in local calendar days). */
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
const short = (s: string) =>
  fromIso(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * D-170: shadcn-style date-range picker (Popover + Calendar). Values are `YYYY-MM-DD` day
 * strings (`''` = open end); the caller turns them into IST times.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  label = 'Date range',
  className,
}: {
  from: string;
  to: string;
  onChange(from: string, to: string): void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = from
    ? { from: fromIso(from), to: to ? fromIso(to) : undefined }
    : undefined;
  const text = from ? (to && to !== from ? `${short(from)} – ${short(to)}` : short(from)) : 'Any date';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative inline-flex', className)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${text}`}
            data-testid="date-range"
            className={cn(
              'flex h-10 items-center gap-2 rounded-md border border-tile-border bg-tile pr-8 pl-3 text-sm outline-none hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-ring',
              from ? 'text-text' : 'text-text-muted',
            )}
          >
            <CalendarDays aria-hidden className="size-4 text-text-faint" />
            <span className="tabular-nums">{text}</span>
          </button>
        </Popover.Trigger>
        {from && (
          <button
            type="button"
            aria-label="Clear dates"
            data-testid="date-range-clear"
            onClick={() => onChange('', '')}
            className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-text-faint outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 rounded-tile border border-glass-border bg-surface-solid shadow-float"
          data-testid="date-range-popover"
        >
          <Calendar
            mode="range"
            numberOfMonths={1}
            selected={selected}
            defaultMonth={selected?.from}
            disabled={{ after: new Date() }}
            onSelect={(r) => {
              const f = r?.from ? toIso(r.from) : '';
              const t = r?.to ? toIso(r.to) : '';
              onChange(f, t);
              if (f && t && f !== t) setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
