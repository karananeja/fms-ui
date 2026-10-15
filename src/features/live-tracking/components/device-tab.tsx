import { TONE_COLOR, type Cell, type DeviceView } from '../lib/vehicle-details-model';
import { CellStrip } from './cell-strip';
import { CopyButton, SectionLabel, Skeleton, StatTile, Tile } from './details-ui';

/** Device ID, comms tiles and the cell strip (F07-R10). */
export function DeviceTab({ device, cells }: { device: DeviceView | null; cells: Cell[] | null }) {
  if (!device) return <Skeleton className="h-60" label="device" />;
  const tone = (t: DeviceView['auxTone']) => (t === 'none' ? undefined : TONE_COLOR[t]);
  return (
    <>
      <Tile className="flex items-center gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.1em] text-text-muted uppercase">
            Device ID
          </div>
          <div className="truncate text-[17px] font-semibold" data-testid="device-id">
            {device.deviceId}
          </div>
        </div>
        <CopyButton value={device.deviceId} label="Copy device ID" />
      </Tile>
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Aux battery"
          value={device.aux}
          color={tone(device.auxTone)}
          testId="device-aux"
        />
        <StatTile label="Internal" value={device.internal} testId="device-internal" />
        <StatTile label="Signal" value={device.signal} />
        <StatTile label="GPS fix" value={device.fix} color={tone(device.fixTone)} />
      </div>
      <Tile>
        <SectionLabel>Battery cells · voltage</SectionLabel>
        <div className="mt-1.5">
          {cells ? <CellStrip cells={cells} /> : <Skeleton className="h-[70px]" label="cells" />}
        </div>
      </Tile>
    </>
  );
}
