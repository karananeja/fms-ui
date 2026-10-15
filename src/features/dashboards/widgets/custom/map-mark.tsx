import { MapPinOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { datasetFields, type CustomSpec } from '@shared/contract/widget-grammar.ts';
import type { Cell } from '@shared/domain/widget-shape.ts';
import { useCan } from '@/features/access/permissions/can';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import { MAP_STYLE_URLS } from '@/features/live-tracking/config/basemap-urls';
import type { LivePoints } from '@/features/live-tracking/worker/worker-api';
import { themeStore } from '@/shared/theme/theme-store';
import { useWidgetData } from '../../data/use-widget-data';
import { registerSnapshotMap } from '../../lib/snapshot-canvas';
import { categoryColor, cellLabel, type Labeller } from './custom-format';
import type { CustomMapController, MapPoint } from './custom-map-controller';

function supportsWebGL(): boolean {
  if (typeof WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Trail of the followed vehicle (REST, refreshed with the page) + positions seen live since. */
function useFollowTrail(spec: CustomSpec, vehicleId: string | null, at: [number, number] | null) {
  const minutes = spec.mark.follow ? spec.mark.trailMinutes : undefined;
  const allowed = useCan('vehicle.details.view');
  const url =
    minutes && vehicleId && allowed
      ? `/api/vehicles/${encodeURIComponent(vehicleId)}/trail?minutes=${minutes}`
      : null;
  const entry = useWidgetData(url ? { key: url, url: () => url } : null);
  const base = useMemo(
    () =>
      ((entry.data as { points?: [number, number, number][] } | undefined)?.points ?? []).map(
        ([lng, lat]) => [lng, lat] as [number, number],
      ),
    [entry.data],
  );
  const [live, setLive] = useState<{ base: unknown; coords: [number, number][] }>({
    base: null,
    coords: [],
  });
  const lng = at?.[0];
  const lat = at?.[1];
  // Positions seen since the trail was fetched (state adjusted during render; converges at once).
  if (minutes && lng !== undefined && lat !== undefined) {
    const coords = live.base === base ? live.coords : [];
    const last = coords.at(-1) ?? base.at(-1);
    if (!last || last[0] !== lng || last[1] !== lat)
      setLive({ base, coords: [...coords, [lng, lat] as [number, number]].slice(-2000) });
    else if (live.base !== base) setLive({ base, coords });
  }
  return minutes ? [...base, ...(live.base === base ? live.coords : [])] : [];
}

/**
 * F26 map mark (D-146): live points (coloured by a field, optional clusters / size), a
 * vehicle-history trail, or a follow-one-vehicle view with its trail. MapLibre is imported
 * lazily, inside the dashboard chunk.
 */
export function MapMark({
  spec,
  points,
  trailRows,
  total,
  labeller,
}: {
  spec: CustomSpec;
  points: LivePoints | null;
  trailRows: Record<string, Cell>[] | null;
  total: number;
  labeller: Labeller;
}) {
  const container = useRef<HTMLDivElement>(null);
  const ctl = useRef<CustomMapController | null>(null);
  const [failed, setFailed] = useState(() => !supportsWebGL());
  const [loaded, setLoaded] = useState(false);
  const updates = useRef(0);
  const m = spec.mark;
  const fields = datasetFields(spec.data);
  const follow = !!m.follow;

  const mapPoints = useMemo<MapPoint[]>(() => {
    if (!points) return [];
    const order = new Map<string, number>();
    const sizes = points.size.filter((s): s is number => typeof s === 'number');
    const lo = Math.min(...sizes);
    const hi = Math.max(...sizes);
    return points.ids.map((id, k) => {
      const c = points.color[k] ?? null;
      const key = String(c);
      if (!order.has(key)) order.set(key, order.size);
      const s = points.size[k];
      const radius = follow
        ? 9
        : typeof s === 'number' && hi > lo
          ? 4 + ((s - lo) / (hi - lo)) * 6
          : 5;
      return {
        id,
        lng: points.lng[k]!,
        lat: points.lat[k]!,
        color: m.color ? categoryColor(m.color, c, order.get(key)!) : 'var(--accent)',
        radius,
      };
    });
  }, [points, m.color, follow]);

  const followed = follow && points?.ids.length ? points : null;
  const at: [number, number] | null = followed ? [followed.lng[0]!, followed.lat[0]!] : null;
  const followTrail = useFollowTrail(spec, followed?.ids[0] ?? null, at);
  const trail = useMemo<[number, number][]>(
    () =>
      trailRows
        ? trailRows
            .filter((r) => typeof r.lng === 'number' && typeof r.lat === 'number')
            .map((r) => [r.lng as number, r.lat as number])
        : followTrail,
    [trailRows, followTrail],
  );

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void import('./custom-map-controller').then(({ CustomMapController }) => {
      if (cancelled || !container.current) return;
      try {
        const c = new CustomMapController(container.current, MAP_STYLE_URLS, themeStore(), {
          cluster: !!m.cluster && !follow,
          follow,
          fit: m.fit ?? true,
        });
        const unregister = registerSnapshotMap(c.map);
        const ro = new ResizeObserver(() => c.resize());
        ro.observe(container.current);
        ctl.current = c;
        setLoaded(true);
        destroy = () => {
          ro.disconnect();
          unregister();
          c.destroy();
          ctl.current = null;
        };
      } catch (e) {
        console.error('[custom-map]', e);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [failed, m.cluster, m.fit, follow]);

  useEffect(() => {
    if (!loaded) return;
    ctl.current?.setPoints(mapPoints);
    updates.current++;
    container.current?.setAttribute('data-updates', String(updates.current));
  }, [loaded, mapPoints]);
  useEffect(() => {
    if (loaded) ctl.current?.setTrail(trail);
  }, [loaded, trail]);

  const legend = useMemo(() => {
    if (!points || !m.color || follow) return [];
    const seen = new Map<string, Cell>();
    for (const c of points.color) if (!seen.has(String(c)) && seen.size < 8) seen.set(String(c), c);
    return [...seen.values()].map((c, k) => ({
      label: cellLabel(m.color, c, fields[m.color!], labeller),
      color: categoryColor(m.color, c, k),
    }));
  }, [points, m.color, follow, fields, labeller]);

  if (failed)
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-text-muted">
        <MapPinOff aria-hidden className="size-5 text-text-faint" />
        <p>This browser can’t show maps (WebGL is off).</p>
      </div>
    );

  const shown = points?.ids.length ?? 0;
  const label = followed ? (followed.label[0] ?? followed.regnos[0]) : null;
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-tile-border">
        <div
          ref={container}
          className="widget-no-drag h-full w-full"
          data-testid="custom-map"
          data-points={shown}
          data-total={total}
          data-trail={trail.length}
          data-follow={followed ? followed.regnos[0] : undefined}
          data-lnglat={at ? `${at[0].toFixed(5)},${at[1].toFixed(5)}` : undefined}
          aria-label={followed ? `Map following ${followed.regnos[0]}` : `Map of ${formatNum(shown)} vehicles`}
          role="img"
        />
        {label !== null && (
          <span className="pointer-events-none absolute top-2 left-2 rounded-md border border-glass-border bg-surface-solid px-2 py-1 text-[11px] font-semibold shadow-[0_4px_12px_var(--shadow)]">
            {String(label)}
          </span>
        )}
        {legend.length > 0 && (
          <ul className="pointer-events-none absolute bottom-2 left-2 flex max-w-[90%] flex-wrap gap-x-2 gap-y-0.5 rounded-md border border-glass-border bg-surface-solid/90 px-2 py-1 text-[10px]">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="shrink-0 pt-1.5 text-[11px] text-text-faint" data-testid="custom-footer">
        {trailRows
          ? `${formatNum(trail.length)} trail points`
          : followed
            ? `Live · ${trail.length > 1 ? `trail ${m.trailMinutes} min` : 'no trail yet'}`
            : shown < total
              ? `${formatNum(shown)} of ${formatNum(total)} vehicles`
              : `${formatNum(total)} vehicles`}
      </p>
    </div>
  );
}
