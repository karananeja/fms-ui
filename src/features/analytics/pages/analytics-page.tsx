import { useNavigate, useSearch } from '@tanstack/react-router';
import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { listFleets } from '@/features/access/api/access-api';
import { AdminLayout } from '@/features/access/components/admin-layout';
import { LoadError, Segmented } from '@/features/access/components/admin-ui';
import { FleetFilter } from '@/features/access/fleets/fleet-filter';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { inputClass } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { AnalyticsStore } from '../analytics-store';
import type { AnalyticsParams } from '../api/analytics-api';
import { AnalyticsCharts } from '../components/analytics-charts';
import { EntityDrilldown } from '../components/entity-drilldown';
import { KpiTiles } from '../components/kpi-tiles';
import { RankingTable, type Entity } from '../components/ranking-table';
import { DRIVER_COLS, VEHICLE_COLS } from '../lib/ranking-columns';
import {
  downloadCsv,
  DRIVER_SORTS,
  DRIVER_TILES,
  istDate,
  parseFilters,
  toCsv,
  toSearch,
  VEHICLE_SORTS,
  VEHICLE_TILES,
  windowOf,
  type Filters,
  type RangeId,
  type Tab,
} from '../lib/analytics-model';
import { fetchDriverRanking, fetchVehicleRanking, type DriverRanking } from '../api/analytics-api';
import type { VehicleRanking } from '@shared/contract/index.ts';

const TOP = 10;
const ALL = 500;
const card = 'rounded-[var(--radius-panel)] p-4 shadow-panel glass';

/** `/analytics` (F16): filters (URL), KPI tiles, daily charts, ranking, drill-down, CSV. */
export function AnalyticsPage({ store: given }: { store?: AnalyticsStore }) {
  const [store] = useState(() => given ?? new AnalyticsStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const filters = parseFilters(search);
  const setFilters = (patch: Partial<Filters>) =>
    void navigate({ to: '/analytics', search: toSearch({ ...filters, ...patch }), replace: true });

  const fleetsRes = useResource((signal) => listFleets({ signal }));
  const fleets = useMemo(() => fleetsRes.data ?? [], [fleetsRes.data]);
  const fleetName = (id: string) => fleets.find((f) => f.id === id)?.name ?? 'Fleet';

  const [sort, setSort] = useState<{ vehicles: string; drivers: string }>({
    vehicles: 'distanceKm',
    drivers: 'score',
  });
  const [worst, setWorst] = useState(false);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Entity | null>(null);
  const [exporting, setExporting] = useState(false);

  // The window is fixed per filter change (not every render), so cached queries match.
  const filterKey = JSON.stringify(filters);
  // eslint-disable-next-line react-hooks/purity, react-hooks/exhaustive-deps -- the window's end is read once per filter change
  const now = useMemo(() => Date.now(), [filterKey]);
  const w = windowOf(filters, now);
  const params: AnalyticsParams = {
    from: w.from,
    to: w.to,
    ...(filters.fleetId && { fleetId: filters.fleetId }),
    ...(filters.vehicleId && filters.tab === 'vehicles' && { vehicleId: filters.vehicleId }),
    ...(filters.driverId && filters.tab === 'drivers' && { driverId: filters.driverId }),
  };
  const view = {
    tab: filters.tab,
    params,
    sort: sort[filters.tab],
    asc: worst,
    limit: all ? ALL : TOP,
  };
  const viewKey = AnalyticsStore.keyOf(view);
  useEffect(() => {
    void store.load(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `viewKey` captures the view
  }, [store, viewKey]);

  const data = state.data;
  const exportCsv = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const p = { ...params, sort: `${sort[filters.tab]}${worst ? ':asc' : ''}`, limit: ALL };
      const ranking =
        filters.tab === 'vehicles' ? await fetchVehicleRanking(p) : await fetchDriverRanking(p);
      const rows =
        filters.tab === 'vehicles'
          ? (ranking as VehicleRanking).items.map((r) => VEHICLE_COLS.map((c) => c.cell(r)))
          : (ranking as DriverRanking).items.map((r) => DRIVER_COLS.map((c) => c.cell(r)));
      const header = (filters.tab === 'vehicles' ? VEHICLE_COLS : DRIVER_COLS).map((c) => c.header);
      const plain = (s: string) => s.replace(/,/g, '');
      const ranked = toCsv(
        header,
        rows.map((r) => r.map(plain)),
      );
      const series = toCsv(
        [
          'Day',
          'Distance km',
          'Drive h',
          'Idle h',
          'Downtime h',
          'No-GPS h',
          'Energy kWh',
          'Charge sessions',
          'Breakdowns',
          'Harsh braking',
          'Harsh acceleration',
          'Overspeed',
        ],
        data.series.points.map(({ day, kpis: k }) => [
          day,
          k.distanceKm.toFixed(1),
          (k.driveMs / 3.6e6).toFixed(2),
          (k.idleMs / 3.6e6).toFixed(2),
          (k.downtimeMs / 3.6e6).toFixed(2),
          (k.noGpsMs / 3.6e6).toFixed(2),
          k.energyKwh.toFixed(1),
          k.chargeSessions,
          k.breakdowns,
          k.harshBrake,
          k.harshAccel,
          k.overspeed,
        ]),
      );
      downloadCsv(
        `fleet-analytics-${filters.tab}-${istDate(w.from)}-${istDate(w.to - 1)}.csv`,
        `${ranked}\n${series}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const sorts = filters.tab === 'vehicles' ? VEHICLE_SORTS : DRIVER_SORTS;
  const focus = filters.tab === 'vehicles' ? filters.vehicleId : filters.driverId;

  return (
    <AdminLayout
      title="Analytics"
      description={`${filters.fleetId ? fleetName(filters.fleetId) : 'All your fleets'} · ${istDate(w.from)} → ${istDate(w.to - 1)} (IST)`}
      actions={
        <Button variant="outline" onClick={() => void exportCsv()} disabled={!data || exporting}>
          <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="analytics-filters">
        <Segmented<Tab>
          label="View"
          value={filters.tab}
          onChange={(tab) => setFilters({ tab })}
          options={[
            { value: 'vehicles', label: 'Vehicles' },
            { value: 'drivers', label: 'Drivers' },
          ]}
        />
        <FleetFilter
          fleets={fleets}
          value={filters.fleetId ?? null}
          onChange={(id) => setFilters({ fleetId: id ?? undefined })}
          label={filters.fleetId ? fleetName(filters.fleetId) : 'All fleets'}
        />
        <Segmented<RangeId>
          label="Range"
          value={filters.range}
          onChange={(range) =>
            setFilters(
              range === 'custom'
                ? { range, from: istDate(w.from), to: istDate(w.to - 1) }
                : { range, from: undefined, to: undefined },
            )
          }
          options={[
            { value: '7d', label: '7 d' },
            { value: '30d', label: '30 d' },
            { value: '90d', label: '90 d' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {filters.range === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs">
            <input
              type="date"
              aria-label="From"
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(e) => setFilters({ from: e.target.value })}
              className={cn(inputClass, 'h-10 w-40')}
            />
            →
            <input
              type="date"
              aria-label="To"
              value={filters.to ?? ''}
              min={filters.from}
              max={istDate(now)}
              onChange={(e) => setFilters({ to: e.target.value })}
              className={cn(inputClass, 'h-10 w-40')}
            />
            <span className="text-text-muted">max 90 days</span>
          </span>
        )}
        {focus && (
          <span className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            Focus: {open?.id === focus ? open.label : focus}
            <button
              type="button"
              aria-label="Clear focus"
              onClick={() => setFilters({ vehicleId: undefined, driverId: undefined })}
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {state.error && !data ? (
        <LoadError message={errorText(state.error)} onRetry={() => void store.load({ ...view })} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
          {Array.from({ length: 8 }, (_, k) => (
            <div key={k} className="h-28 animate-pulse rounded-[var(--radius-panel)] bg-tile" />
          ))}
        </div>
      ) : (
        <div
          className={cn('flex flex-col gap-4 transition-opacity', state.loading && 'opacity-60')}
          aria-busy={state.loading}
        >
          <KpiTiles
            defs={filters.tab === 'vehicles' ? VEHICLE_TILES : DRIVER_TILES}
            kpis={data.summary.kpis}
            previous={data.previous?.kpis ?? null}
            series={data.series}
          />
          <AnalyticsCharts tab={filters.tab} series={data.series} />
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                {worst ? 'Bottom' : 'Top'} {all ? data.ranking.items.length : TOP} by{' '}
                {sorts.find((s) => s.key === sort[filters.tab])?.label.toLowerCase()}
                <span className="ml-2 tracking-normal normal-case">
                  of {data.ranking.total.toLocaleString('en-IN')}
                </span>
              </h2>
              <select
                aria-label="Rank by"
                value={sort[filters.tab]}
                onChange={(e) => setSort((s) => ({ ...s, [filters.tab]: e.target.value }))}
                className={cn(inputClass, 'h-9 w-auto')}
              >
                {sorts.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Segmented<'best' | 'worst'>
                label="Order"
                value={worst ? 'worst' : 'best'}
                onChange={(v) => setWorst(v === 'worst')}
                options={[
                  { value: 'best', label: 'Highest' },
                  { value: 'worst', label: 'Lowest' },
                ]}
              />
              <Button variant="outline" size="sm" onClick={() => setAll((a) => !a)}>
                {all ? `Show top ${TOP}` : `View all (max ${ALL})`}
              </Button>
            </div>
            <RankingTable tab={filters.tab} ranking={data.ranking} onOpen={setOpen} tall={all} />
          </section>
        </div>
      )}
      <EntityDrilldown entity={open} params={params} onClose={() => setOpen(null)} />
    </AdminLayout>
  );
}
