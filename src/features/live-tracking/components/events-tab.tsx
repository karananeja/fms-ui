import { memo } from 'react';
import { STATUS_META } from '../config/status-meta';
import type { EventItem } from '../lib/vehicle-details-model';

/** Status / ignition timeline, newest first (F07-R11). Only observed or reported events. */
export const EventsTimeline = memo(function EventsTimeline({ items }: { items: EventItem[] }) {
  if (!items.length) {
    return (
      <p className="py-4 text-center text-xs text-text-muted" data-testid="events-empty">
        No events since you opened this vehicle
      </p>
    );
  }
  return (
    <ol className="flex flex-col" aria-label="Vehicle events" data-testid="events-timeline">
      {items.map((e, k) => {
        const color = e.status ? STATUS_META[e.status].color : 'var(--text-muted)';
        return (
          <li
            key={e.key}
            className="grid min-h-[34px] grid-cols-[54px_20px_1fr] items-start gap-2 text-xs"
          >
            <time className="pt-0.5 text-[11px] text-text-muted">{e.time}</time>
            <span className="relative flex h-full justify-center">
              <span
                className="z-[1] grid size-[18px] place-items-center rounded-full"
                style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}
              >
                <span className="size-2 rounded-full" style={{ background: color }} />
              </span>
              {k < items.length - 1 && (
                <span className="absolute top-[18px] -bottom-0.5 w-px bg-tile-border" />
              )}
            </span>
            <span className="pb-2">
              <b className="block font-black">{e.title}</b>
              <span className="text-[11px] text-text-muted">{e.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
});

export function EventsTab({ items }: { items: EventItem[] }) {
  return (
    <div className="rounded-[var(--radius-tile)] border border-tile-border bg-tile p-3">
      <EventsTimeline items={items} />
    </div>
  );
}
