import { memo } from 'react';
import type { Widget } from '@shared/contract/dashboards.ts';
import { useNow } from '@/shared/hooks/use-now';
import { DailyChartWidget } from './daily-chart-widget';
import { DriverListWidget } from './driver-list-widget';
import { KpiWidget } from './kpi-widget';
import { RankingWidget } from './ranking-widget';
import { RequestsSummaryWidget } from './requests-summary-widget';
import { StatusBreakdownWidget } from './status-breakdown-widget';
import { TextWidget } from './text-widget';
import { VehicleListWidget } from './vehicle-list-widget';

function RequestsWithClock({ w }: { w: Extract<Widget, { type: 'requests-summary' }> }) {
  const now = useNow(60_000);
  return <RequestsSummaryWidget w={w} now={now} />;
}

/** §6.3: one renderer per catalogue type (memoised by the widget object). */
export const WidgetRenderer = memo(function WidgetRenderer({ widget: w }: { widget: Widget }) {
  switch (w.type) {
    case 'kpi':
      return <KpiWidget w={w} />;
    case 'daily-chart':
      return <DailyChartWidget w={w} />;
    case 'status-breakdown':
      return <StatusBreakdownWidget w={w} />;
    case 'ranking':
      return <RankingWidget w={w} />;
    case 'vehicle-list':
      return <VehicleListWidget w={w} />;
    case 'driver-list':
      return <DriverListWidget w={w} />;
    case 'requests-summary':
      return <RequestsWithClock w={w} />;
    case 'text':
      return <TextWidget w={w} />;
    default: {
      const never: never = w;
      return never;
    }
  }
});

/** Widgets fed by the worker (shown with a "live" dot). */
export const isLiveWidget = (w: Widget) =>
  (w.type === 'kpi' && w.source === 'live') ||
  w.type === 'status-breakdown' ||
  w.type === 'vehicle-list';
