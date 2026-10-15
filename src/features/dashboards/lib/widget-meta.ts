import {
  BarChart3,
  ClipboardList,
  Gauge,
  LayoutGrid,
  ListOrdered,
  PieChart,
  StickyNote,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { TimeRange, Widget, WidgetInput } from '@shared/contract/dashboards.ts';

/** F23: per-type icon and name (shared by list cards, preview cards and grid frames). */
const TYPES: Record<string, { icon: LucideIcon; name: string }> = {
  kpi: { icon: Gauge, name: 'KPI' },
  'daily-chart': { icon: BarChart3, name: 'Daily chart' },
  'status-breakdown': { icon: PieChart, name: 'Status breakdown' },
  ranking: { icon: ListOrdered, name: 'Ranking' },
  'vehicle-list': { icon: Truck, name: 'Vehicle list' },
  'driver-list': { icon: Users, name: 'Driver list' },
  'requests-summary': { icon: ClipboardList, name: 'Requests' },
  text: { icon: StickyNote, name: 'Note' },
};

/** Unknown (newer) types fall back to a generic tile. */
export const widgetTypeInfo = (type: string) =>
  TYPES[type] ?? { icon: LayoutGrid, name: type.replace(/-/g, ' ') };

export const RANGE_TEXT: Record<TimeRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export const RANGE_SHORT: Record<TimeRange, string> = {
  today: 'Today',
  yesterday: 'Yday',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
};

type AnyWidget = Widget | WidgetInput;

/** Where a widget's data comes from: Live (worker), Analytics, Drivers, Requests or Note. */
export function widgetSource(w: AnyWidget): string {
  switch (w.type) {
    case 'kpi':
      return w.source === 'live' ? 'Live' : 'Analytics';
    case 'status-breakdown':
    case 'vehicle-list':
      return 'Live';
    case 'daily-chart':
    case 'ranking':
      return 'Analytics';
    case 'driver-list':
      return 'Drivers';
    case 'requests-summary':
      return 'Requests';
    case 'text':
      return 'Note';
    default:
      return 'Data';
  }
}

/** The widget's time range, if it has one. */
export function widgetRange(w: AnyWidget): TimeRange | null {
  return 'range' in w && typeof w.range === 'string' ? (w.range as TimeRange) : null;
}

/** Ordered unique widget types (for the card's icon strip). */
export const uniqueTypes = (widgets: readonly { type: string }[]) => [
  ...new Set(widgets.map((w) => w.type)),
];
