import { compassLabel } from '../lib/vehicle-details-model';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';

const selectHeading = (s: LiveTrackingState): number | null => {
  if (!s.selectedVehicleId) return null;
  const c = s.selected?.vehicleId === s.selectedVehicleId ? s.selected.combinfo : null;
  const h =
    c?.heading ??
    (s.selectedSummary?.vehicleId === s.selectedVehicleId ? s.selectedSummary.heading : NaN);
  return Number.isFinite(h) ? h : null;
};

/** Glass compass beside the details card with the selected vehicle's heading (F07-R12). */
export function HeadingCompass({ store = liveTrackingStore }: { store?: LiveTrackingStore }) {
  const heading = useLiveTracking(selectHeading, Object.is, store);
  if (heading === null) return null;
  const label = compassLabel(heading);
  return (
    <div
      role="img"
      aria-label={`Heading ${Math.round(heading)}° ${label}`}
      data-testid="heading-compass"
      className="absolute top-[72px] right-[446px] z-20 hidden size-16 place-items-center rounded-full glass lg:grid"
    >
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
        <g style={{ stroke: 'var(--text-faint)' }}>
          <line x1="28" y1="4" x2="28" y2="9" />
          <line x1="28" y1="47" x2="28" y2="52" />
          <line x1="4" y1="28" x2="9" y2="28" />
          <line x1="47" y1="28" x2="52" y2="28" />
        </g>
        <g
          transform={`rotate(${heading} 28 28)`}
          className="motion-safe:transition-transform motion-safe:duration-300"
        >
          <path d="M28 12 32 28 28 26 24 28Z" style={{ fill: 'var(--accent)' }} />
          <path d="M28 44 32 28 28 30 24 28Z" style={{ fill: 'var(--st-gpsnever)' }} />
        </g>
        <text
          x="28"
          y="32"
          textAnchor="middle"
          fontWeight="600"
          fontSize="10"
          style={{ fill: 'var(--text)' }}
        >
          {label}
        </text>
      </svg>
    </div>
  );
}
