import type { Combinfo, Lafparsed, Me, Permission } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { releaseProxy, type Remote } from 'comlink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import combinfoSample from '../../../../mock-server/fixtures/combinfo-sample.json';
import lafparsedSample from '../../../../mock-server/fixtures/lafparsed-sample.json';
import { Toaster } from '@/shared/ui/sonner';
import { LiveTrackingStore } from '../store/live-tracking-store';
import type {
  LivePush,
  LiveTrackingWorkerApi,
  SelectedVehicle,
  VehicleSummary,
} from '../worker/worker-api';
import { VehicleDetailsPanel } from './vehicle-details-panel';

const combinfo = combinfoSample as Combinfo;
const lafparsed = lafparsedSample as Lafparsed;
const ID = combinfo.vehicleid;
const ALL: Permission[] = ['live.view', 'vehicle.details.view', 'vehicle.parameters.view'];
const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as LivePush['statusCounts'];

const summary = {
  vehicleId: ID,
  regno: combinfo.regno,
  make: 'BGauss',
  model: 'C12',
  variant: 'i Max',
  fuelType: 'EV',
  gpstime: combinfo.gpstime,
  canutctime: combinfo.canutctime,
  status: 'stopped',
} as VehicleSummary;

function setup(permissions: Permission[] = ALL, found = true) {
  let onPush: (p: LivePush) => void = () => {};
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn(async () => found),
    getVehicleSummary: vi.fn(async () => summary),
    setViewport: vi.fn(async () => null),
    getBounds: vi.fn(async () => null),
    getClusterExpansionZoom: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
    [releaseProxy]: vi.fn(),
  };
  const store = new LiveTrackingStore({
    createWorkerApi: () => api as unknown as Remote<LiveTrackingWorkerApi>,
    fetchTrail: async () => [],
  });
  store.start({ fleetIds: ['f0'], permissions } as unknown as Me);
  const push = (selected: SelectedVehicle) =>
    act(() =>
      onPush({
        connection: 'live',
        stats: { ...store.getSnapshot().stats, snapshotComplete: true },
        version: 1,
        statusCounts: counts,
        total: 1,
        filteredCounts: counts,
        filteredTotal: 1,
        selectedMatches: true,
        selected,
      }),
    );
  const payloads = (l: Lafparsed = lafparsed, history?: SelectedVehicle['history']) =>
    push({ vehicleId: ID, found: true, status: 'pullout', combinfo, lafparsed: l, history });
  return { api, store, push, payloads };
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

const panel = () => screen.getByRole('region', { name: 'Vehicle details' });

beforeEach(() => mockDesktop());
afterEach(() => vi.unstubAllGlobals());

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const sample = (t: number, soc: number) => ({ t, soc, speed: 0, lat: null, lng: null });

describe('F07-T5: vehicle details panel', () => {
  it('hero from the summary at once, skeletons until payloads, then fixture values', async () => {
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    expect(screen.queryByRole('region')).toBeNull();
    await act(() => store.selectVehicle(ID));
    expect(screen.getByTestId('details-regno')).toHaveTextContent('P6DED30BPDC002607');
    expect(panel()).toHaveTextContent('BGAUSS · C12 · I MAX');
    expect(screen.getByRole('status', { name: 'Loading overview' })).toBeInTheDocument();
    expect(panel()).toHaveFocus();

    payloads();
    const p = panel();
    expect(screen.queryByRole('status', { name: 'Loading overview' })).toBeNull();
    expect(screen.getByTestId('details-gps-rel')).toHaveAttribute(
      'data-abs',
      '08 Sep 26 | 09:33:42',
    );
    expect(screen.getByTestId('details-latest')).toHaveTextContent('08 SEP 26 | 09:33:49');
    expect(within(p).getByTestId('details-status').querySelector('[data-status]')).toHaveAttribute(
      'data-status',
      'pullout',
    );
    expect(within(screen.getByTestId('ring-battery')).getByTestId('ring-value')).toHaveTextContent(
      '49%',
    );
    expect(within(screen.getByTestId('ring-range')).getByTestId('ring-value')).toHaveTextContent(
      '56',
    );
    expect(within(screen.getByTestId('ring-health')).getByTestId('ring-value')).toHaveTextContent(
      '100.0',
    );
    expect(screen.getByTestId('badge-signal').querySelector('[data-bars]')).toHaveAttribute(
      'data-bars',
      '3',
    );
    expect(screen.getByTestId('badge-gps')).toHaveTextContent('NONE');
    expect(screen.getByTestId('kv-odo')).toHaveTextContent('1,077 KM');
    expect(screen.getByTestId('session-collecting')).toBeInTheDocument();
    expect(p).not.toHaveTextContent(/Reports|Analytics|Share live location/);
  });

  it('all four tabs: overview chart, parameters, device, events', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    const t = combinfo.utctime;
    payloads(lafparsed, {
      samples: [sample(t, 52), sample(t + 60_000, 49)],
      events: [{ t, kind: 'status', status: 'pullout', from: 'stopped', soc: 49, lat: 1, lng: 2 }],
    });
    expect(
      screen.getByRole('img', { name: /State of charge this session, now 49%/ }),
    ).toBeInTheDocument();

    await user.click(tab(/Device/));
    expect(screen.getByTestId('device-id')).toHaveTextContent('158828DB0439AE67');
    expect(screen.getByTestId('device-aux')).toHaveTextContent('0.07 V');
    expect(screen.getByTestId('device-internal')).toHaveTextContent('3.60 V');
    expect(screen.getByTestId('cell-strip').querySelectorAll('rect')).toHaveLength(20);
    expect(screen.getByTestId('cell-strip').querySelectorAll('[data-lowest]')).toHaveLength(1);

    await user.click(tab(/Events/));
    expect(screen.getByTestId('events-timeline')).toHaveTextContent('Battery pulled out');

    await user.click(tab(/Parameters/));
    expect(screen.getAllByRole('row')).toHaveLength(374);
  });

  it('events empty state', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads(lafparsed, { samples: [], events: [] });
    await user.click(tab(/Events/));
    expect(screen.getByTestId('events-empty')).toHaveTextContent(
      'No events since you opened this vehicle',
    );
  });

  it('parameters: search (label or key), chips and the tab count', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    expect(screen.getByTestId('details-param-count')).toHaveTextContent('374');
    await user.click(tab(/Parameters/));
    await user.type(screen.getByRole('searchbox', { name: 'Search parameters' }), 'cell_voltage');
    expect(screen.getByTestId('details-param-count')).toHaveTextContent('23');
    expect(screen.getAllByRole('row')).toHaveLength(23);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'Time To');
    const row = screen.getByRole('row');
    expect(row).toHaveTextContent('Time To Charge');
    expect(row).toHaveTextContent('N/A');
    expect(row).toHaveAttribute('title', 'time_to_charge · 08 Sep 26 | 08:24:19');
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: 'CELLS' }));
    const keys = screen.getAllByRole('row').map((r) => r.getAttribute('data-pid')!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('cell_'))).toBe(true);
    expect(screen.getByTestId('details-param-count')).toHaveTextContent(String(keys.length));
  });

  it('copy writes to the clipboard and shows a "Copied" toast', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(
      <>
        <VehicleDetailsPanel store={store} />
        <Toaster />
      </>,
    );
    await act(() => store.selectVehicle(ID));
    payloads();
    await user.click(screen.getByRole('button', { name: 'Copy registration number' }));
    expect(await navigator.clipboard.readText()).toBe('P6DED30BPDC002607');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await user.click(tab(/Device/));
    await user.click(screen.getByRole('button', { name: 'Copy device ID' }));
    expect(await navigator.clipboard.readText()).toBe('158828DB0439AE67');
  });

  it('locate, close and Esc go through the store', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    const locate = vi.spyOn(store, 'locateVehicle').mockResolvedValue();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    await user.click(screen.getByRole('button', { name: 'Locate on map' }));
    expect(locate).toHaveBeenCalledWith(ID);
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(store.getSnapshot().selectedVehicleId).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();

    await act(() => store.selectVehicle(ID));
    await user.keyboard('{Escape}');
    expect(store.getSnapshot().selectedVehicleId).toBeNull();
  });

  it('not found: message and Close', async () => {
    const user = userEvent.setup();
    const { store } = setup(ALL, false);
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle('nope'));
    expect(panel()).toHaveTextContent('Vehicle not available in your fleets');
    await user.click(within(panel()).getByRole('button', { name: 'Close' }));
    expect(store.getSnapshot().selectedVehicleId).toBeNull();
  });

  it('permissions: Parameters tab hidden without vehicle.parameters.view; no panel without vehicle.details.view', async () => {
    const { store, payloads } = setup(['live.view', 'vehicle.details.view']);
    const { unmount } = render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Device',
      'Events',
    ]);
    expect(screen.queryByTestId('details-param-count')).toBeNull();
    unmount();

    const other = setup(['live.view']);
    render(<VehicleDetailsPanel store={other.store} />);
    await act(() => other.store.selectVehicle(ID));
    other.payloads();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('below 1024 px it renders a bottom sheet at 35% without the absolute time', async () => {
    mockDesktop(false);
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    const sheet = screen.getByRole('dialog', { name: 'Vehicle details' });
    expect(sheet).toHaveAttribute('data-snap', '0.35');
    expect(within(sheet).getByTestId('details-regno')).toHaveTextContent('P6DED30BPDC002607');
    expect(within(sheet).getByTestId('ring-battery')).toBeInTheDocument();
    expect(within(sheet).queryByTestId('details-latest')).toBeNull();
  });
});

describe('F07-T6: live updates re-render only changed parameter rows', () => {
  it('one PID changed → only that row renders again', async () => {
    const user = userEvent.setup();
    const renders = new Map<string, number>();
    const onCellRender = (pid: string) => renders.set(pid, (renders.get(pid) ?? 0) + 1);
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} onCellRender={onCellRender} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    await user.click(tab(/Parameters/));
    expect(renders.size).toBe(374);
    expect([...renders.values()].every((n) => n === 1)).toBe(true);

    renders.clear();
    const next = structuredClone(lafparsed);
    next.candata.motor_temperature = { pidvalue: 42, valtype: 2, timestamp: Date.now() };
    payloads(next);
    expect([...renders]).toEqual([['motor_temperature', 1]]);
    expect(document.querySelector('[data-pid="motor_temperature"]')).toHaveTextContent('42');

    renders.clear();
    payloads(structuredClone(next));
    expect(renders.size).toBe(0);
  });
});
