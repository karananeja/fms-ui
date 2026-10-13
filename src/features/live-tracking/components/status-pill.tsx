import type { VehicleStatus } from '@shared/domain/vehicle-status';
import { STATUS_META } from '../config/status-meta';

/** Mockup `.status`: tinted pill with a dot. */
export function StatusPill({ status }: { status: VehicleStatus }) {
  const { label, color } = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black tracking-[0.06em] uppercase"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      data-status={status}
    >
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
