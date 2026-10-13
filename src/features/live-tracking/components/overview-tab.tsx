import type { EventItem, Overview, SessionChart as Chart } from '../lib/vehicle-details-model';
import { SectionLabel, Skeleton, Tile } from './details-ui';
import { EventsTimeline } from './events-tab';
import { SessionChart } from './session-chart';
import { Speedometer } from './speedometer';

const RECENT = 3;

/** Speedometer + key values, session SOC chart, recent events (F07-R8). */
export function OverviewTab({
  overview,
  chart,
  events,
}: {
  overview: Overview | null;
  chart: Chart | null;
  events: EventItem[];
}) {
  return (
    <>
      {overview ? (
        <Tile className="grid grid-cols-[150px_1fr] items-center gap-3">
          <Speedometer speed={overview.speed} text={overview.speedText} />
          <dl className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-[7px] text-xs">
            <dt className="text-text-muted">Odometer</dt>
            <dd className="text-right font-extrabold" data-testid="kv-odo">
              {overview.odo}
            </dd>
            <dt className="text-text-muted">Motor speed</dt>
            <dd className="text-right font-extrabold">{overview.motorSpeed}</dd>
            <dt className="text-text-muted">Motor temp</dt>
            <dd className="text-right font-extrabold">{overview.motorTemp}</dd>
            <dt className="text-text-muted">Ignition</dt>
            <dd
              className={
                overview.ignition.on
                  ? 'text-right font-extrabold text-ok'
                  : 'text-right font-extrabold text-text-muted'
              }
            >
              {overview.ignition.text}
            </dd>
          </dl>
        </Tile>
      ) : (
        <Skeleton className="h-[124px]" label="overview" />
      )}
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
    </>
  );
}
