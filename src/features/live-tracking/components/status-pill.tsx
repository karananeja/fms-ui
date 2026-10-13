import type { VehicleStatus } from '@shared/domain/vehicle-status';
import { STATUS_META } from '../config/status-meta';

export function StatusPill({ status }: { status: VehicleStatus }) {
  const { label, color, icon: Icon } = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold"
      style={{ color, borderColor: color }}
      data-status={status}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
