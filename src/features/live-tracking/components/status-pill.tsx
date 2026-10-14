import type { VehicleStatus } from '@shared/domain/vehicle-status';
import type { ReactNode } from 'react';
import { STATUS_META } from '../config/status-meta';

/** Mockup `.status`: tinted pill with a dot in `color` (any CSS colour). */
export function TintPill({
  color,
  children,
  ...data
}: {
  color: string;
  children: ReactNode;
  [data: `data-${string}`]: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black tracking-[0.06em] whitespace-nowrap uppercase"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      {...data}
    >
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

/** A vehicle status pill. */
export function StatusPill({ status }: { status: VehicleStatus }) {
  const { label, color } = STATUS_META[status];
  return (
    <TintPill color={color} data-status={status}>
      {label}
    </TintPill>
  );
}
