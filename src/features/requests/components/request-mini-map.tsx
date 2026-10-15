import type { GeoPoint } from '@shared/contract/index.ts';
import { MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE_URLS } from '@/features/live-tracking/config/basemap-urls';
import { themeStore } from '@/shared/theme/theme-store';

function supportsWebGL(): boolean {
  if (typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * F14-R2 / §3: the request location as a small map. MapLibre loads lazily, after the drawer's
 * first paint (no long task when the drawer opens).
 */
export function RequestMiniMap({ location }: { location: GeoPoint | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(() => !supportsWebGL());
  const lat = location?.lat;
  const lng = location?.lng;

  useEffect(() => {
    if (failed || lat === undefined || lng === undefined) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    // Two frames: let the drawer paint before the map chunk is fetched and parsed.
    const raf = requestAnimationFrame(() =>
      setTimeout(() => {
        void import('./mini-map-controller').then(({ createMiniMap }) => {
          if (cancelled || !container.current) return;
          try {
            destroy = createMiniMap(container.current, MAP_STYLE_URLS, themeStore(), { lat, lng });
          } catch (e) {
            console.error('[request-map]', e);
            setFailed(true);
          }
        });
      }, 0),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      destroy?.();
    };
  }, [failed, lat, lng]);

  if (!location || failed) {
    return (
      <div className="flex h-36 flex-col items-center justify-center gap-1.5 rounded-tile border border-tile-border bg-map-bg text-xs text-text-muted">
        <MapPinOff aria-hidden className="size-5" />
        {location ? 'The map can’t be shown in this browser.' : 'Location unknown'}
      </div>
    );
  }
  return (
    <div
      ref={container}
      role="img"
      aria-label={`Reported location ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
      data-testid="request-map"
      className="h-36 overflow-hidden rounded-tile border border-tile-border bg-map-bg"
    />
  );
}
