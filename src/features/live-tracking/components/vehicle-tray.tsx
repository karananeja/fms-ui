import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { STATUS_META } from '../config/status-meta';
import { illustrationFor } from '../lib/vehicle-details-model';
import {
  liveTrackingStore,
  type LiveTrackingState,
  type LiveTrackingStore,
} from '../store/live-tracking-store';
import { tableViewStore, type TableViewStore } from '../store/table-view';
import { useLiveTracking } from '../store/use-live-tracking';
import { useTableView } from '../store/use-table-view';
import type { TrayCard } from '../worker/worker-api';
import { VehicleIllustration } from './vehicle-illustration';

const COLLAPSED_KEY = 'fms.tray.collapsed';
const DASH = '—';

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** `KA01AB123456` → `KA01A…3456` when longer than `max` (F09-R11). */
const middle = (s: string, max = 11) => (s.length <= max ? s : `${s.slice(0, 5)}…${s.slice(-4)}`);

const fmt = (v: number | null, unit: string) => (v === null ? DASH : `${Math.round(v)}${unit}`);

/** Two stats by status: running → speed + SOC; otherwise SOC + DTE. */
function stats(c: TrayCard): [string, string][] {
  return c.status === 'running'
    ? [
        ['Speed', fmt(c.speed, ' km/h')],
        ['SOC', fmt(c.soc, '%')],
      ]
    : [
        ['SOC', fmt(c.soc, '%')],
        ['DTE', fmt(c.dte, ' km')],
      ];
}

const selectFrame = (s: LiveTrackingState) => s.mapFrame;
const selectSelected = (s: LiveTrackingState) => s.selectedVehicleId;

/**
 * F09-R11 (desktop): glass cards for matching vehicles in the map view, refreshed with each map
 * frame; clicking a card selects that vehicle.
 */
export function VehicleTray({
  live = liveTrackingStore,
  table = tableViewStore,
}: {
  live?: LiveTrackingStore;
  table?: TableViewStore;
}) {
  const frame = useLiveTracking(selectFrame, Object.is, live);
  const selected = useLiveTracking(selectSelected, Object.is, live);
  const fleets = useTableView((s) => s.fleetNames, table);
  const [cards, setCards] = useState<TrayCard[]>([]);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => void table.loadFleetNames(), [table]);

  // A new frame means the view or the data changed: re-query the tray (F09-R6).
  useEffect(() => {
    const bbox = live.viewportBbox;
    if (!frame || !bbox || collapsed) return;
    let stale = false;
    void live.getTray(bbox).then((next) => !stale && setCards(next));
    return () => {
      stale = true;
    };
  }, [frame, live, collapsed]);

  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1');
    } catch {
      // Storage unavailable: not remembered.
    }
  };

  return (
    <section
      aria-label="Vehicles in view"
      data-testid="vehicle-tray"
      className={cn(
        'pointer-events-auto absolute bottom-3.5 left-[300px] z-10 flex max-w-[calc(100%-314px)] flex-col gap-2',
        selected && 'max-w-[calc(100%-314px-434px)]',
      )}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={toggle}
        className="flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-[11px] font-black tracking-[0.14em] text-text-muted uppercase glass outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
      >
        In view · {cards.length}
        <ChevronDown
          className={cn('size-3.5 transition-transform', collapsed && 'rotate-180')}
          aria-hidden
        />
      </button>
      {!collapsed && (
        <ul className="flex [scrollbar-width:thin] gap-2.5 overflow-x-auto pb-1">
          {cards.map((c) => {
            const color = c.status ? STATUS_META[c.status].color : 'var(--text-faint)';
            const on = c.vehicleId === selected;
            return (
              <li key={c.vehicleId} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  data-vehicle-id={c.vehicleId}
                  title={c.regno}
                  onClick={() => void live.selectVehicle(c.vehicleId)}
                  className={cn(
                    'flex w-[220px] items-center gap-2.5 rounded-tile p-2.5 text-left shadow-[0_8px_24px_var(--shadow)] glass outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    on && 'ring-2 ring-accent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-black">{middle(c.regno || DASH)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-text-muted uppercase">
                      {c.model || DASH} · {fleets[c.fleetId] ?? c.fleetId}
                    </span>
                    <span className="mt-1.5 flex gap-3 text-[11px] text-text-muted">
                      {stats(c).map(([k, v]) => (
                        <span key={k}>
                          {k} <b className="font-extrabold text-text">{v}</b>
                        </span>
                      ))}
                    </span>
                  </span>
                  <VehicleIllustration
                    kind={illustrationFor(c.assetType)}
                    className="h-9 w-[72px] shrink-0"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
