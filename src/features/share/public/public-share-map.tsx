import { LocateFixed, MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { preloadShareMap } from './share-map-loader';
import type { MapPadding, ShareMapController, ShareMapView } from './share-map-controller';

/** F10-R10: light basemap; e2e points it at `/map-styles/blank-light.json`. */
const STYLE_URL =
  import.meta.env.VITE_SHARE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';

function supportsWebGL(): boolean {
  if (typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** MapLibre container; `share-map-controller` (loaded lazily with MapLibre) does the wiring. */
export function PublicShareMap({ view, padding }: { view: ShareMapView; padding: MapPadding }) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ShareMapController | null>(null);
  const viewRef = useRef(view);
  const paddingRef = useRef(padding);
  const [failed, setFailed] = useState(() => !supportsWebGL());
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    void preloadShareMap().then(({ ShareMapController }) => {
      if (cancelled || !container.current) return;
      try {
        controller.current = new ShareMapController(container.current, STYLE_URL, setFollowing);
        controller.current.setPadding(paddingRef.current);
        controller.current.update(viewRef.current);
      } catch (e) {
        console.error('[share-map]', e);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      controller.current?.destroy();
      controller.current = null;
    };
  }, [failed]);

  useEffect(() => {
    viewRef.current = view;
    controller.current?.update(view);
  }, [view]);

  useEffect(() => {
    paddingRef.current = padding;
    controller.current?.setPadding(padding);
  }, [padding]);

  if (failed) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-2 bg-map-bg p-6 text-center"
      >
        <MapPinOff className="size-8 text-text-muted" aria-hidden />
        <p className="font-bold">The map can't be shown</p>
        <p className="max-w-sm text-sm text-text-muted">
          This browser has WebGL turned off. The details below keep updating.
        </p>
      </div>
    );
  }
  return (
    <>
      <div ref={container} className="h-full w-full bg-map-bg" data-testid="share-map" />
      {!following && (
        <button
          type="button"
          onClick={() => controller.current?.recenter()}
          className="absolute right-4 bottom-[calc(var(--share-bottom-inset,16px)+8px)] z-10 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-text shadow-[0_8px_24px_var(--shadow)] glass lg:bottom-8"
        >
          <LocateFixed className="size-4 text-[var(--accent-text)]" aria-hidden />
          Recenter
        </button>
      )}
    </>
  );
}
