import type { VehicleStatus } from '@shared/domain/vehicle-status.ts';
import {
  BatteryCharging,
  BatteryWarning,
  CircleDashed,
  CircleStop,
  Lock,
  MapPinOff,
  Navigation,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

export interface StatusMeta {
  label: string;
  /** F00 colour token, e.g. `var(--st-running)`. */
  color: string;
  icon: LucideIcon;
  /** Lucide icon name (for non-React consumers such as map sprites). */
  iconName: string;
}

/** The single source of status label, colour and icon for every UI (marker, chip, pill, table). */
export const STATUS_META: Record<VehicleStatus, StatusMeta> = {
  running: {
    label: 'Running',
    color: 'var(--st-running)',
    icon: Navigation,
    iconName: 'navigation',
  },
  stopped: {
    label: 'Stopped',
    color: 'var(--st-stopped)',
    icon: CircleStop,
    iconName: 'circle-stop',
  },
  immobilized: {
    label: 'Immobilized',
    color: 'var(--st-immobilized)',
    icon: Lock,
    iconName: 'lock',
  },
  'non-comm': {
    label: 'Non-comm',
    color: 'var(--st-noncomm)',
    icon: WifiOff,
    iconName: 'wifi-off',
  },
  charging: {
    label: 'Charging',
    color: 'var(--st-charging)',
    icon: BatteryCharging,
    iconName: 'battery-charging',
  },
  pullout: {
    label: 'Pullout',
    color: 'var(--st-pullout)',
    icon: BatteryWarning,
    iconName: 'battery-warning',
  },
  'no-gps': { label: 'No GPS', color: 'var(--st-nogps)', icon: MapPinOff, iconName: 'map-pin-off' },
  'gps-never': {
    label: 'GPS never',
    color: 'var(--st-gpsnever)',
    icon: CircleDashed,
    iconName: 'circle-dashed',
  },
};
