import type { RedactedCombinfo } from '@shared/contract/payloads.ts';
import type { ShareOptions } from '@shared/contract/share-links.ts';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { formatAge, formatIstShort } from './share-format';

const DASH = '—';
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDp = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** Signal bars by `rxdbm`: ≥ each threshold lights a bar (3 bars). */
const SIGNAL_BARS = [-100, -85, -70];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v: number | null, f: Intl.NumberFormat, unit = '') =>
  v === null ? DASH : `${f.format(v)}${unit}`;

function Metric({ label, value, testId }: { label: string; value: ReactNode; testId: string }) {
  return (
    <div className="min-w-0 rounded-tile border border-tile-border bg-tile px-3 py-2.5">
      <div className="text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
        {label}
      </div>
      <div className="mt-1 truncate text-[15px] font-black" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function Group({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} aria-label={title}>
      <h2 className="mb-2 text-[11px] font-extrabold tracking-[0.14em] text-text-faint uppercase">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

function SocRing({ soc }: { soc: number | null }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const fill = soc === null ? 0 : Math.max(0, Math.min(1, soc / 100));
  return (
    <div className="flex items-center gap-2.5">
      <svg width="34" height="34" viewBox="0 0 36 36" className="-rotate-90" aria-hidden>
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="4"
          style={{ stroke: 'var(--tile-border)' }}
        />
        {soc !== null && (
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${fill * c} ${c}`}
            style={{ stroke: 'var(--accent)' }}
          />
        )}
      </svg>
      <span>{fmt(soc, int, '%')}</span>
    </div>
  );
}

function SignalBars({ dbm }: { dbm: number | null }) {
  const lit = dbm === null ? 0 : SIGNAL_BARS.filter((t) => dbm >= t).length;
  return (
    <span className="flex items-center gap-2" aria-label={`Signal ${lit} of 3 bars`}>
      <span className="flex h-4 items-end gap-[3px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'w-[4px] rounded-sm',
              i < lit ? 'bg-[var(--accent-text)]' : 'bg-tile-border',
            )}
            style={{ height: `${6 + i * 5}px` }}
          />
        ))}
      </span>
      <span>{dbm === null ? DASH : `${int.format(dbm)} dBm`}</span>
    </span>
  );
}

export interface PublicMetricsProps {
  show: ShareOptions['show'];
  latest: RedactedCombinfo | null;
  moving: boolean | null;
  /** Server-corrected now, for the "last update" age. */
  now: number;
}

/**
 * F10-R12: metric cards for the groups the link allows. A hidden group renders nothing at all
 * (no heading, no labels); its values are not in the payload anyway (D-026).
 */
export function PublicMetrics({ show, latest, moving, now }: PublicMetricsProps) {
  const can = latest?.parsedcandata;
  const gps = num(latest?.gpstime);
  return (
    <div className="flex flex-col gap-4">
      <Group title="Location" testId="share-group-location">
        <Metric
          label="Last GPS update"
          testId="share-metric-gps"
          value={
            gps === null ? (
              DASH
            ) : (
              <span title={formatIstShort(gps)}>
                {formatAge(gps, now)}
                <span className="block text-[11px] font-bold text-text-muted">
                  {formatIstShort(gps)}
                </span>
              </span>
            )
          }
        />
        <Metric
          label="Status"
          testId="share-metric-motion"
          value={latest && moving !== null ? (moving ? 'Moving' : 'Stopped') : DASH}
        />
        <Metric
          label="Ignition"
          testId="share-metric-ignition"
          value={latest ? (latest.ignstatus === 1 ? 'On' : 'Off') : DASH}
        />
      </Group>
      {show.drivingEnergy && (
        <Group title="Driving · energy" testId="share-group-driving">
          <Metric
            label="Speed"
            testId="share-metric-speed"
            value={fmt(num(latest?.speed), int, ' km/h')}
          />
          <Metric
            label="SOC"
            testId="share-metric-soc"
            value={<SocRing soc={num(can?.soc?.pidvalue)} />}
          />
          <Metric
            label="Range"
            testId="share-metric-range"
            value={fmt(num(can?.dte?.pidvalue), int, ' km')}
          />
          <Metric
            label="Odometer"
            testId="share-metric-odometer"
            value={fmt(num(can?.odometer?.pidvalue), int, ' km')}
          />
        </Group>
      )}
      {show.device && (
        <Group title="Device" testId="share-group-device">
          <Metric
            label="Signal"
            testId="share-metric-signal"
            value={<SignalBars dbm={num(latest?.rxdbm)} />}
          />
          <Metric
            label="Device battery"
            testId="share-metric-device-battery"
            value={fmt(num(latest?.devbattery), twoDp, ' V')}
          />
          <Metric
            label="Car battery"
            testId="share-metric-car-battery"
            value={fmt(num(latest?.carbattery), oneDp, ' V')}
          />
        </Group>
      )}
    </div>
  );
}
