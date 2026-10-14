import type { DriverMe } from '@shared/contract/index.ts';
import { MapPin, Truck } from 'lucide-react';
import { StatusPill } from '@/features/live-tracking/components/status-pill';
import { deriveStatus } from '@/features/live-tracking/worker/status-deriver';
import { formatAge, formatIstShort } from '@/features/share/public/share-format';

const mapsHref = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/**
 * F13-R2: the driver's vehicle, condensed F07 card. Regno, make · model, status pill, last update
 * (relative + IST), SOC and range when present, last known area with "Open in Maps".
 */
export function MyVehicleCard({ vehicle, now }: { vehicle: DriverMe['vehicle']; now: number }) {
  if (!vehicle)
    return (
      <section
        className="rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid p-4"
        data-testid="my-vehicle-none"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-tile bg-tile text-text-faint">
            <Truck className="size-5" aria-hidden />
          </span>
          <p className="text-sm text-text-muted">
            No vehicle assigned. Contact your fleet operator.
          </p>
        </div>
      </section>
    );

  const { meta, live } = vehicle;
  const status = deriveStatus(live, now);
  const updated = Math.max(live.utctime, live.canutctime);
  const hasFix = live.lat !== 0 || live.lng !== 0;
  return (
    <section
      aria-label="My vehicle"
      data-testid="my-vehicle"
      className="rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid p-4 shadow-[0_30px_80px_rgb(0_0_0/0.35)]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black tracking-[0.12em] text-text-muted uppercase">
            My vehicle
          </p>
          <h2 className="truncate text-2xl font-black tracking-[0.04em]" data-testid="my-regno">
            {meta.regno}
          </h2>
          <p className="truncate text-xs text-text-muted">
            {meta.make} · {meta.model}
          </p>
        </div>
        <StatusPill status={status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        {meta.fuelType === 'EV' || live.soc > 0 ? (
          <div className="rounded-tile border border-tile-border bg-tile p-2.5">
            <dt className="text-text-muted">Battery</dt>
            <dd className="text-lg font-black tabular-nums">{Math.round(live.soc)}%</dd>
          </div>
        ) : null}
        {live.dte > 0 && (
          <div className="rounded-tile border border-tile-border bg-tile p-2.5">
            <dt className="text-text-muted">Range</dt>
            <dd className="text-lg font-black tabular-nums">{Math.round(live.dte)} km</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs text-text-muted" title={formatIstShort(updated)}>
        Updated {formatAge(updated, now)} · {formatIstShort(updated)}
      </p>
      {hasFix && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
          <MapPin className="size-3.5" aria-hidden />
          <span className="tabular-nums">
            {live.lat.toFixed(5)}, {live.lng.toFixed(5)}
          </span>
          <a
            href={mapsHref(live.lat, live.lng)}
            target="_blank"
            rel="noreferrer"
            className="font-extrabold text-accent hover:underline"
          >
            Open in Maps
          </a>
        </p>
      )}
    </section>
  );
}
