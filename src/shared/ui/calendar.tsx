import type { ComponentProps } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/shared/lib/utils';

/**
 * D-170: shadcn's Calendar (react-day-picker) in DS3 tokens. Unstyled DayPicker (no stylesheet
 * import); every part is classed here so both themes follow `theme.css`.
 */
export function Calendar({ className, classNames, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-3 text-text', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center px-9',
        caption_label: 'text-sm font-semibold',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'grid size-8 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        button_next:
          'grid size-8 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-[11px] font-medium text-text-faint',
        week: 'mt-1 flex',
        day: 'relative size-9 p-0 text-center text-sm',
        day_button:
          'size-9 rounded-md tabular-nums outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring',
        today: 'font-bold text-accent',
        selected: '[&>button]:bg-accent [&>button]:text-accent-ink [&>button]:hover:bg-accent',
        range_start: 'rounded-l-md',
        range_end: 'rounded-r-md',
        range_middle:
          'bg-accent-soft [&>button]:!bg-transparent [&>button]:!text-text [&>button]:rounded-none',
        outside: 'text-text-faint opacity-60',
        disabled: 'text-text-faint opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: c }) =>
          orientation === 'left' ? (
            <ChevronLeft aria-hidden className={cn('size-4', c)} />
          ) : (
            <ChevronRight aria-hidden className={cn('size-4', c)} />
          ),
      }}
      {...props}
    />
  );
}
