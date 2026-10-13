import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status';
import { ChevronDown } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { STATUS_META } from '../config/status-meta';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import type { ConnectionState } from '../worker/worker-api';
import { StatusPill } from './status-pill';

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-warn animate-pulse' },
  live: { label: 'Live', dot: 'bg-ok' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-warn animate-pulse' },
  offline: { label: 'Offline', dot: 'bg-text-muted' },
  unauthenticated: { label: 'Signed out', dot: 'bg-text-muted' },
  error: { label: 'Error', dot: 'bg-accent' },
};

const selectConnection = (s: LiveTrackingState) => s.connection;
const selectStats = (s: LiveTrackingState) => s.stats;
const selectSelected = (s: LiveTrackingState) => s.selected;
const selectSelectedId = (s: LiveTrackingState) => s.selectedVehicleId;
const selectCounts = (s: LiveTrackingState) => s.statusCounts;
const selectTotal = (s: LiveTrackingState) => s.total;
const selectFrame = (s: LiveTrackingState) => s.mapFrame;

const fmt = new Intl.NumberFormat('en-IN');
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const offset = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} s`;

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function ConnectionBadge() {
  const { label, dot } = CONNECTION[useLiveTracking(selectConnection)];
  return (
    <span className="flex items-center gap-2 text-sm font-medium" data-testid="live-connection">
      <span className={cn('size-2.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  );
}

function FeedStats() {
  const s = useLiveTracking(selectStats);
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Vehicles">
        <span data-testid="live-vehicle-count">{fmt.format(s.vehicleCount)}</span>
      </Stat>
      <Stat label="Snapshot">{s.snapshotComplete ? 'Complete' : 'Streaming…'}</Stat>
      <Stat label="Rows / s">{fmt.format(s.rowsPerSec)}</Stat>
      <Stat label="Messages / s">{fmt.format(s.msgsPerSec)}</Stat>
      <Stat label="Last message">{s.lastMessageAt ? formatIst(s.lastMessageAt) : '—'}</Stat>
      <Stat label="Reconnects">{s.reconnects}</Stat>
      <Stat label="Worker state">
        <span data-testid="live-state-size">{mb(s.stateBytes)}</span>
      </Stat>
      <Stat label="Server clock offset">
        <span data-testid="live-server-offset" data-ms={s.serverOffsetMs}>
          {offset(s.serverOffsetMs)}
        </span>
      </Stat>
      <Stat label="Status sweep">
        <span data-testid="live-sweep-ms">{s.sweepMs.toFixed(1)} ms</span>
      </Stat>
      <Stat label="Cluster rebuild">
        <span data-testid="live-cluster-build-ms">{s.clusterBuildMs.toFixed(0)} ms</span>
      </Stat>
      <MapFrameStat />
    </dl>
  );
}

function MapFrameStat() {
  const f = useLiveTracking(selectFrame);
  return (
    <Stat label="Map frame">
      {f ? `#${f.version} · ${f.clusters.id.length} cl · ${f.points.ids.length} pt` : '—'}
    </Stat>
  );
}

function StatusCounts() {
  const counts = useLiveTracking(selectCounts);
  const total = useLiveTracking(selectTotal);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Vehicle status">
      {VEHICLE_STATUSES.map((status) => {
        const { label, color } = STATUS_META[status];
        return (
          <li key={status} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
            <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
            <span className="text-sm">{label}</span>
            <span
              className="ml-auto font-medium tabular-nums"
              data-testid={`status-count-${status}`}
            >
              {fmt.format(counts[status])}
            </span>
          </li>
        );
      })}
      <li className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
        <span className="text-sm font-medium">Total</span>
        <span className="ml-auto font-medium tabular-nums" data-testid="status-total">
          {fmt.format(total)}
        </span>
      </li>
    </ul>
  );
}

function SelectedVehicle() {
  const selectedId = useLiveTracking(selectSelectedId);
  const selected = useLiveTracking(selectSelected);
  if (!selectedId) return null;
  if (selected?.found === false) {
    return <p className="text-sm text-text-muted">{selectedId} is not in your fleets.</p>;
  }
  const c = selected?.combinfo;
  if (!c) return <p className="text-sm text-text-muted">Waiting for {selectedId}…</p>;
  const pidCount = selected.lafparsed ? Object.keys(selected.lafparsed.candata).length : 0;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="live-selected">
      <Stat label="Status">
        <span data-testid="live-selected-status">
          {selected.status ? <StatusPill status={selected.status} /> : '—'}
        </span>
      </Stat>
      <Stat label="Reg. no">{c.regno}</Stat>
      <Stat label="Lat / Lng">
        {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
      </Stat>
      <Stat label="Speed">{c.speed}</Stat>
      <Stat label="SoC">{c.parsedcandata.soc.pidvalue}</Stat>
      <Stat label="Lafparsed PIDs">{pidCount}</Stat>
    </dl>
  );
}

function VehiclePicker() {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void liveTrackingStore.selectVehicle(value.trim() || null);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="live-select-vehicle" className="text-sm text-text-muted">
        Select vehicle
      </label>
      <input
        id="live-select-vehicle"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="vehicleId"
        className="h-9 min-w-0 flex-1 rounded-md border bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
      />
      <Button type="submit" size="sm">
        Select
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setValue('');
          void liveTrackingStore.selectVehicle(null);
        }}
      >
        Clear
      </Button>
    </form>
  );
}

function LocateVehicle() {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) void liveTrackingStore.locateVehicle(value.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="live-locate-vehicle" className="text-sm text-text-muted">
        Locate vehicle ID
      </label>
      <input
        id="live-locate-vehicle"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="vehicleId"
        className="h-9 min-w-0 flex-1 rounded-md border bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
      />
      <Button type="submit" size="sm">
        Locate
      </Button>
    </form>
  );
}

/** F04/F05 live-feed diagnostics over the map, shown with `?debug=1` (UAT aid). */
export function DebugOverlay() {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label="Diagnostics"
      className="absolute top-2 left-2 z-10 flex max-h-[calc(100%-1rem)] w-[min(30rem,calc(100%-1rem))] flex-col rounded-[var(--radius-card)] border bg-surface-1/95 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-2">
        <h2 className="text-sm font-medium tracking-wider text-text-muted uppercase">
          Diagnostics
        </h2>
        <div className="flex items-center gap-2">
          <ConnectionBadge />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label={open ? 'Collapse diagnostics' : 'Expand diagnostics'}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown className={cn('transition-transform', open || '-rotate-90')} />
          </Button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-4 overflow-auto px-4 pb-4">
          <FeedStats />
          <h3 className="text-sm font-medium tracking-wider text-text-muted uppercase">Status</h3>
          <StatusCounts />
          <VehiclePicker />
          <LocateVehicle />
          <SelectedVehicle />
        </div>
      )}
    </section>
  );
}
