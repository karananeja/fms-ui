import type { Me, Permission } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { releaseProxy, type Remote } from 'comlink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableRow } from '../config/table-columns';
import { LiveTrackingStore } from '../store/live-tracking-store';
import { csvFilename, TableViewStore } from '../store/table-view';
import type { LivePush, LiveTrackingWorkerApi, TableQuery } from '../worker/worker-api';
import { TableView } from './table-view';

const TOTAL = 100_000;
const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as LivePush['statusCounts'];
const row = (k: number): TableRow => ({
  vehicleId: `v${k}`,
  regno: `KA01AB${String(k).padStart(6, '0')}`,
  vin: `VIN${k}`,
  deviceId: `d${k}`,
  fleetId: 'f0',
  status: 'running',
  speed: 40,
  soc: 80,
  dte: 120,
  odometer: 12345.6,
  ignition: 1,
  gpstime: 1_760_000_000_000,
  canutctime: null,
  lat: 12.9,
  lng: 77.6,
});

function setup(permissions: Permission[] = ['live.view', 'vehicle.details.view', 'table.export']) {
  let onPush: (p: LivePush) => void = () => {};
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn(async () => true),
    getVehicleSummary: vi.fn(async () => null),
    setViewport: vi.fn(async () => null),
    getBounds: vi.fn(async () => null),
    getClusterExpansionZoom: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
    setFleetNames: vi.fn(async () => {}),
    queryTable: vi.fn(async (q: TableQuery) => ({
      total: TOTAL,
      version: 1,
      rows: Array.from({ length: Math.min(q.limit, TOTAL - q.offset) }, (_, k) =>
        row(q.offset + k),
      ),
    })),
    exportCsv: vi.fn(async () => ({ blob: new Blob(['a']), rows: TOTAL })),
    getTray: vi.fn(async () => []),
    [releaseProxy]: vi.fn(),
  };
  const live = new LiveTrackingStore({
    createWorkerApi: () => api as unknown as Remote<LiveTrackingWorkerApi>,
    fetchTrail: async () => [],
  });
  live.start({ fleetIds: ['f0'], permissions } as unknown as Me);
  const download = vi.fn();
  const store = new TableViewStore(live, {
    fetchFleets: async () => [
      { id: 'f0', parentId: null, name: 'North', depth: 1, vehicleCount: 1 },
    ],
    download,
    now: () => Date.UTC(2026, 9, 14, 6, 35), // 12:05 IST
  });
  const push = () =>
    act(() =>
      onPush({
        connection: 'live',
        stats: { ...live.getSnapshot().stats, rowsPerSec: Math.random() },
        version: 1,
        statusCounts: counts,
        total: TOTAL,
      }),
    );
  const ui = () =>
    render(<TableView store={store} live={live} onBack={vi.fn()} onLocate={vi.fn()} />);
  return { api, live, store, push, ui, download };
}

function mockDesktop(matches = true) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

// jsdom has no layout: the virtualiser measures its scroller with these.
const SIZE = { offsetWidth: 1200, offsetHeight: 800 };

beforeEach(() => {
  mockDesktop();
  for (const [k, v] of Object.entries(SIZE))
    vi.spyOn(HTMLElement.prototype, k as keyof typeof SIZE, 'get').mockReturnValue(v);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 800,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const dataRows = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-vehicle-id'));

describe('F09-T5: table view', () => {
  it('renders a virtual window of a 1 lakh table: about 50 rows in the DOM', async () => {
    const { ui } = setup();
    ui();
    await screen.findByText('KA01AB000000');
    expect(screen.getByTestId('table-count')).toHaveTextContent('All · 1,00,000 vehicles');
    const n = dataRows().length;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThanOrEqual(60);
    expect(screen.getByRole('table', { name: 'Vehicles' })).toHaveAttribute(
      'aria-rowcount',
      String(TOTAL + 1),
    );
    // Fleet names come from /api/fleets; numbers are grouped for display.
    expect(await screen.findAllByText('North')).not.toHaveLength(0);
    expect(within(dataRows()[0]!).getByText('12,345')).toBeInTheDocument();
  });

  it('header clicks sort through the worker query', async () => {
    const { api, ui } = setup();
    ui();
    await screen.findByText('KA01AB000000');
    await userEvent.click(screen.getByRole('button', { name: 'SOC (%)' }));
    expect(api.queryTable).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { column: 'soc', dir: 'asc' }, offset: 0 }),
    );
    await userEvent.click(screen.getByRole('button', { name: /SOC/ }));
    expect(api.queryTable).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { column: 'soc', dir: 'desc' } }),
    );
    expect(screen.getByRole('columnheader', { name: /SOC/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('the column menu hides columns and remembers the choice', async () => {
    const { ui, store } = setup();
    const { unmount } = ui();
    await screen.findByText('KA01AB000000');
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /VIN/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: 'VIN' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('fms.table.columns.desktop')!)).not.toContain('vin');
    unmount();
    // A fresh open reads the saved columns.
    store.open('desktop');
    expect(store.getSnapshot().columns).not.toContain('vin');
    store.close();
  });

  it('Pause freezes the window and counts the updates waiting', async () => {
    const { api, ui, push } = setup();
    ui();
    await screen.findByText('KA01AB000000');
    await userEvent.click(screen.getByRole('button', { name: 'Pause live updates' }));
    const calls = api.queryTable.mock.calls.length;
    push();
    push();
    push();
    expect(screen.getByTestId('paused-badge')).toHaveTextContent('Paused · 3 updates');
    expect(api.queryTable.mock.calls.length).toBe(calls);
    await userEvent.click(screen.getByRole('button', { name: 'Resume live updates' }));
    expect(screen.queryByTestId('paused-badge')).toBeNull();
    expect(api.queryTable.mock.calls.length).toBeGreaterThan(calls);
  });

  it('Export is hidden without table.export; with it, the CSV matches the table state', async () => {
    const without = setup(['live.view']);
    const r = without.ui();
    await screen.findByText('KA01AB000000');
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    r.unmount();

    const { api, ui, download } = setup();
    ui();
    await screen.findByText('KA01AB000000');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    expect(api.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'all',
        sort: { column: 'regno', dir: 'asc' },
        columns: expect.arrayContaining(['regno', 'vin']),
      }),
      expect.anything(),
    );
    expect(download.mock.calls[0]![1]).toBe('fleet-vehicles-20261014-1205.csv');
    expect(csvFilename(Date.UTC(2026, 0, 1, 18, 30))).toBe('fleet-vehicles-20260102-0000.csv');
  });

  it('clicking a row selects the vehicle; mobile shows Regno, Status and SOC by default', async () => {
    const { api, ui } = setup();
    ui();
    await screen.findByText('KA01AB000000');
    await userEvent.click(dataRows()[2]!);
    expect(api.selectVehicle).toHaveBeenCalledWith('v2');

    mockDesktop(false);
    const mobile = setup();
    mobile.store.open('mobile');
    expect(mobile.store.getSnapshot().columns).toEqual(['regno', 'status', 'soc']);
  });
});
