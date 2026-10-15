import type { Assignment } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import { MapPinned } from 'lucide-react';
import { SidePanel } from '@/features/access/components/admin-ui';
import { useResource } from '@/features/access/lib/use-resource';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import { apiFetch } from '@/shared/api/api-client';
import { fetchSeries, fetchSummary, type AnalyticsParams } from '../api/analytics-api';
import { dayLabel, istDate } from '../lib/chart-scale';
import { DRIVER_TILES, formatValue, VEHICLE_TILES } from '../lib/analytics-model';
import { AnalyticsCharts } from './analytics-charts';
import type { Entity } from './ranking-table';

interface Driven {
  vehicleId: string;
  regno: string;
  from: number;
  to: number | null;
}

/** The vehicles a driver drove in the window (assignment history; empty without access). */
async function vehiclesDriven(
  driverId: string,
  w: AnalyticsParams,
  signal: AbortSignal,
): Promise<Driven[] | null> {
  const list = await apiFetch<Assignment[]>(
    `/api/assignments?driverId=${encodeURIComponent(driverId)}`,
    { signal },
  ).catch(() => null);
  if (!list) return null;
  const inWindow = list.filter((a) => a.from < w.to && (a.to ?? Infinity) > w.from);
  return Promise.all(
    inWindow.map(async (a) => ({
      vehicleId: a.vehicleId,
      regno:
        (await liveTrackingStore.vehicleSummary(a.vehicleId).catch(() => null))?.regno ??
        a.vehicleId,
      from: a.from,
      to: a.to,
    })),
  );
}

/** F16-R4: a vehicle's or driver's tiles and daily charts for the same window. */
export function EntityDrilldown({
  entity,
  params,
  onClose,
}: {
  entity: Entity | null;
  params: AnalyticsParams;
  onClose: () => void;
}) {
  return (
    <SidePanel
      open={entity !== null}
      onOpenChange={(o) => !o && onClose()}
      title={entity?.label ?? ''}
      description={entity?.kind === 'vehicle' ? 'Vehicle performance' : 'Driver performance'}
    >
      {entity && <Body key={`${entity.kind}:${entity.id}`} entity={entity} params={params} />}
    </SidePanel>
  );
}

function Body({ entity, params }: { entity: Entity; params: AnalyticsParams }) {
  const p: AnalyticsParams = {
    from: params.from,
    to: params.to,
    ...(entity.kind === 'vehicle' ? { vehicleId: entity.id } : { driverId: entity.id }),
  };
  const res = useResource(async (signal) => {
    const [summary, series, driven] = await Promise.all([
      fetchSummary(p, signal),
      fetchSeries(p, signal),
      entity.kind === 'driver' ? vehiclesDriven(entity.id, p, signal) : Promise.resolve(null),
    ]);
    return { summary, series, driven };
  }, `${entity.kind}:${entity.id}:${p.from}:${p.to}`);
  const defs = entity.kind === 'vehicle' ? VEHICLE_TILES : DRIVER_TILES;

  if (res.error && !res.data)
    return <p className="text-sm text-danger">Couldn’t load this {entity.kind}.</p>;
  if (!res.data) return <p className="text-sm text-text-muted">Loading…</p>;
  const { summary, series, driven } = res.data;
  return (
    <div className="flex flex-col gap-4" data-testid="drilldown">
      {entity.kind === 'vehicle' && (
        <Link
          to="/live-tracking"
          search={{ vehicle: entity.id }}
          className="inline-flex items-center gap-2 self-start text-sm font-semibold text-accent hover:underline"
          data-testid="drilldown-live-link"
        >
          <MapPinned className="size-4" aria-hidden /> Open on the live map
        </Link>
      )}
      <dl className="grid grid-cols-2 gap-2">
        {defs.map((d) => (
          <div key={d.id} className="rounded-tile border border-tile-border bg-tile p-2.5">
            <dt className="truncate text-[11px] text-text-muted">{d.label}</dt>
            <dd className="font-display text-lg font-black tabular-nums">
              {formatValue(d.value(summary.kpis))}
              <span className="ml-1 font-sans text-[11px] font-normal text-text-muted">{d.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <AnalyticsCharts tab={entity.kind === 'vehicle' ? 'vehicles' : 'drivers'} series={series} />
      {entity.kind === 'driver' && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            Vehicles driven
          </h3>
          {driven === null ? (
            <p className="text-xs text-text-muted">
              Assignment history needs driver or vehicle access.
            </p>
          ) : !driven.length ? (
            <p className="text-xs text-text-muted">No vehicles in this period.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="vehicles-driven">
              {driven.map((v) => (
                <li
                  key={`${v.vehicleId}-${v.from}`}
                  className="flex items-center gap-2 rounded-tile border border-tile-border bg-tile px-3 py-2 text-sm"
                >
                  <Link
                    to="/live-tracking"
                    search={{ vehicle: v.vehicleId }}
                    className="font-semibold text-accent hover:underline"
                  >
                    {v.regno}
                  </Link>
                  <span className="ml-auto text-xs text-text-muted">
                    {dayLabel(istDate(Math.max(v.from, p.from)))} →{' '}
                    {v.to === null ? 'now' : dayLabel(istDate(v.to))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
