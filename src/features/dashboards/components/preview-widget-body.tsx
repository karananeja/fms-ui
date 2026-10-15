import { use, useEffect, useState, type ReactNode } from 'react';
import type { Widget } from '@shared/contract/dashboards.ts';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { QueryCache } from '../data/query-cache';
import { QueryCacheContext } from '../data/use-widget-data';
import { LiveWidgetSource } from '../live/live-widget-source';
import { LiveWidgetSourceContext } from '../live/use-live-widget';
import { WidgetRenderer } from '../widgets/widget-renderer';
import { WidgetErrorBoundary } from './widget-states';

/**
 * D-135: a chat preview's live widget (F20 renderer, no grid: this module must never import
 * react-grid-layout). On a dashboard page it shares the page's data cache and live source; in
 * the global panel it brings its own.
 */
export default function PreviewWidgetBody({ widget }: { widget: Widget }): ReactNode {
  const pageCache = use(QueryCacheContext);
  const pageLive = use(LiveWidgetSourceContext);
  const [cache] = useState(() => pageCache ?? new QueryCache());
  const [live] = useState(() => pageLive ?? new LiveWidgetSource(liveTrackingStore));
  const own = cache !== pageCache;
  const ownLive = live !== pageLive;

  useEffect(
    () => () => {
      if (own) cache.dispose();
      if (ownLive) live.dispose();
    },
    [cache, live, own, ownLive],
  );

  return (
    <QueryCacheContext value={cache}>
      <LiveWidgetSourceContext value={live}>
        <WidgetErrorBoundary resetKey={JSON.stringify(widget)}>
          <WidgetRenderer widget={widget} />
        </WidgetErrorBoundary>
      </LiveWidgetSourceContext>
    </QueryCacheContext>
  );
}
