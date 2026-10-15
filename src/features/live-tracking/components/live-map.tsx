import { MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { themeStore } from '@/shared/theme/theme-store';
import { MAP_STYLE_URLS } from '../config/basemap-urls';
import { liveTrackingStore } from '../store/live-tracking-store';

function supportsWebGL(): boolean {
  if (typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** MapLibre container; `map-controller` (loaded lazily with MapLibre) does the wiring. */
export function LiveMap() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => !supportsWebGL());

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void import('./map-controller').then(({ MapController }) => {
      if (cancelled || !container.current) return;
      try {
        const theme = themeStore();
        const controller = new MapController(
          container.current,
          liveTrackingStore,
          MAP_STYLE_URLS,
          theme.resolved(),
        );
        // DS3-R13: swap the basemap when the resolved theme changes.
        const off = theme.subscribe(() => controller.setTheme(theme.resolved()));
        destroy = () => {
          off();
          controller.destroy();
        };
      } catch (e) {
        console.error('[map]', e);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [failed]);

  if (failed) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
      >
        <MapPinOff className="size-8 text-text-muted" aria-hidden />
        <p className="font-bold">The map can't be shown</p>
        <p className="max-w-sm text-sm text-text-muted">
          This browser has WebGL turned off or unavailable. Live data keeps updating; enable
          hardware acceleration or use another browser to see the map.
        </p>
      </div>
    );
  }
  return <div ref={container} className="h-full w-full" data-testid="live-map" />;
}
