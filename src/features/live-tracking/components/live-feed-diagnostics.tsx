import { useState, type FormEvent, type ReactNode } from 'react';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { liveTrackingStore, type LiveTrackingState } from '../store/live-tracking-store';
import { useLiveTracking } from '../store/use-live-tracking';
import type { ConnectionState } from '../worker/worker-api';

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
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      <Stat label="Server clock offset">{offset(s.serverOffsetMs)}</Stat>
    </dl>
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
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="live-selected">
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

/** Temporary live-feed panel for UAT (replaced by F06–F08). */
export function LiveFeedDiagnostics() {
  return (
    <section className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Live tracking</h1>
        <ConnectionBadge />
      </div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border bg-surface-1 p-4">
        <h2 className="text-sm font-medium tracking-wider text-text-muted uppercase">Live feed</h2>
        <FeedStats />
        <VehiclePicker />
        <SelectedVehicle />
      </div>
    </section>
  );
}
