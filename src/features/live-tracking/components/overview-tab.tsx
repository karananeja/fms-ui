import { Share2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Button } from '@/shared/ui/button';
import type { EventItem, Overview, SessionChart as Chart } from '../lib/vehicle-details-model';
import { SectionLabel, Skeleton, Tile } from './details-ui';
import { DriverSection, type DriverSectionProps } from './driver-section';
import { EventsTimeline } from './events-tab';
import { NoGpsInsight, type NoGpsInsightProps } from './no-gps-insight';
import { SessionChart } from './session-chart';
import { Speedometer } from './speedometer';

const RECENT = 3;

// F10a: its own chunk, loaded on the first click (the live page stays light).
const ShareDialog = lazy(() =>
  import('@/features/share/manage/share-dialog').then((m) => ({ default: m.ShareDialog })),
);

export interface ShareTarget {
  vehicleId: string;
  regno: string;
}

/** F10-R1: the gradient "Share live location" CTA and its dialog. */
function ShareCta({ target }: { target: ShareTarget }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Button
        size="lg"
        className="w-full"
        data-testid="share-cta"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
      >
        <Share2 /> Share live location
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <ShareDialog
            open={open}
            onOpenChange={setOpen}
            vehicleId={target.vehicleId}
            regno={target.regno}
          />
        </Suspense>
      )}
    </>
  );
}

/**
 * Speedometer + key values, session SOC chart, recent events (F07-R8), and the Share CTA when
 * `share` is set (the caller passes it only with `share.create`, F10-R1).
 */
export function OverviewTab({
  overview,
  chart,
  events,
  share,
  driver,
  noGps,
}: {
  overview: Overview | null;
  chart: Chart | null;
  events: EventItem[];
  share?: ShareTarget | null;
  /** F12-R5: the Driver section's vehicle (omitted in tests that don't cover it). */
  driver?: DriverSectionProps | null;
  /** F14-R5: set only while the vehicle's status is `no-gps` ("Why no GPS?"). */
  noGps?: NoGpsInsightProps | null;
}) {
  return (
    <>
      {overview ? (
        <Tile className="grid grid-cols-[150px_1fr] items-center gap-3">
          <Speedometer speed={overview.speed} text={overview.speedText} />
          <dl className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-[7px] text-xs">
            <dt className="text-text-muted">Odometer</dt>
            <dd className="text-right font-semibold" data-testid="kv-odo">
              {overview.odo}
            </dd>
            <dt className="text-text-muted">Motor speed</dt>
            <dd className="text-right font-semibold">{overview.motorSpeed}</dd>
            <dt className="text-text-muted">Motor temp</dt>
            <dd className="text-right font-semibold">{overview.motorTemp}</dd>
            <dt className="text-text-muted">Ignition</dt>
            <dd
              className={
                overview.ignition.on
                  ? 'text-right font-semibold text-ok'
                  : 'text-right font-semibold text-text-muted'
              }
            >
              {overview.ignition.text}
            </dd>
          </dl>
        </Tile>
      ) : (
        <Skeleton className="h-[124px]" label="overview" />
      )}
      {noGps && <NoGpsInsight key={`no-gps-${noGps.vehicleId}`} {...noGps} />}
      {driver && <DriverSection key={`driver-${driver.vehicleId}`} {...driver} />}
      <Tile>
        <div className="mb-1.5 flex items-center">
          <SectionLabel>Energy · this session</SectionLabel>
          <span className="ml-auto text-[11px] text-text-faint">SOC %</span>
        </div>
        <SessionChart chart={chart} />
      </Tile>
      <Tile>
        <SectionLabel className="mb-2.5 block">Recent events</SectionLabel>
        <EventsTimeline items={events.slice(0, RECENT)} />
      </Tile>
      {share && <ShareCta key={`share-${share.vehicleId}`} target={share} />}
    </>
  );
}
