import { MapPin } from 'lucide-react';
import { memo } from 'react';
import { DASH } from '../lib/vehicle-details-model';
import { CopyButton } from './details-ui';

export const LocationRow = memo(function LocationRow({ location }: { location: string }) {
  return (
    <div className="flex items-center gap-2 text-text-muted">
      <MapPin className="size-4 shrink-0" aria-hidden />
      <span className="tabular-nums" data-testid="details-location">
        {location}
      </span>
      {location !== DASH && <CopyButton value={location} label="Copy location" />}
    </div>
  );
});
