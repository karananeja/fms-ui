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
        selected,
      }),
    );
  const payloads = (l: Lafparsed = lafparsed) =>
    push({ vehicleId: ID, found: true, status: 'pullout', combinfo, lafparsed: l });
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

describe('F07-T4: vehicle details panel', () => {
  it('shows the header from the summary at once, skeletons until payloads, then fixture values', async () => {
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    expect(screen.queryByRole('region')).toBeNull();
    await act(() => store.selectVehicle(ID));
    expect(screen.getByTestId('details-regno')).toHaveTextContent('P6DED30BPDC002607');
    expect(panel()).toHaveTextContent('BGauss · C12 · i Max');
    expect(screen.getByRole('status', { name: 'Loading energy' })).toBeInTheDocument();
    expect(panel()).toHaveFocus();

    payloads();
    const p = panel();
    expect(screen.queryByRole('status', { name: 'Loading energy' })).toBeNull();
    expect(screen.getByTestId('details-gps-time')).toHaveTextContent('08 Sep 26 | 09:33:42');
    expect(screen.getByTestId('details-can-time')).toHaveTextContent('08 Sep 26 | 09:33:49');
    expect(within(p).getByTestId('details-status').querySelector('[data-status]')).toHaveAttribute(
      'data-status',
      'pullout',
    );
    expect(screen.getByTestId('details-soc')).toHaveTextContent('49%');
    expect(screen.getByTestId('details-soc')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByTestId('details-dte')).toHaveTextContent('56');
    expect(screen.getByTestId('details-soh')).toHaveTextContent('100.0');
    expect(screen.getByTestId('details-odo')).toHaveTextContent('1,077');
    expect(screen.getByTestId('details-device-id')).toHaveTextContent('158828DB0439AE67');
    expect(screen.getByTestId('details-aux')).toHaveTextContent('0.07');
    expect(screen.getByTestId('details-internal')).toHaveTextContent('3.60');
    expect(screen.getByTestId('details-signal')).toHaveTextContent('-70');
    expect(screen.getByTestId('details-location')).toHaveTextContent('28.70419, 80.56578');
    expect(p).not.toHaveTextContent(/Reports|Analytics|Share live location/);
  });

  it('expand switches to gauges + grid; collapse returns to the compact card', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    expect(panel()).toHaveAttribute('data-details-panel', 'compact');
    expect(screen.queryByRole('img', { name: 'Speed gauge' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand view' }));
    expect(panel()).toHaveAttribute('data-details-panel', 'expanded');
    expect(screen.getByRole('img', { name: 'Speed gauge' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Motor gauge' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Parameters' })).getAllByRole('listitem'),
    ).toHaveLength(374);
    expect(screen.getByTestId('details-odo-strip')).toHaveTextContent('0001077');

    await user.click(screen.getByRole('button', { name: 'Collapse view' }));
    expect(panel()).toHaveAttribute('data-details-panel', 'compact');
    expect(screen.queryByRole('img', { name: 'Speed gauge' })).toBeNull();
  });

  it('parameter search narrows the count (label or key)', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    expect(screen.getByTestId('details-param-count')).toHaveTextContent('(374)');
    const toggle = screen.getByRole('button', { name: /Parameters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.type(screen.getByRole('searchbox', { name: 'Search parameters' }), 'cell_voltage');
    expect(screen.getByTestId('details-param-count')).toHaveTextContent('(23)');
    expect(screen.getAllByRole('listitem')).toHaveLength(23);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'Time To');
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Time To Charge');
    expect(item).toHaveTextContent('N/A');
    expect(item).toHaveAttribute('title', 'time_to_charge · 08 Sep 26 | 08:24:19');
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
    await user.click(screen.getByRole('button', { name: 'Copy device ID' }));
    expect(await navigator.clipboard.readText()).toBe('158828DB0439AE67');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy location' }));
    expect(await navigator.clipboard.readText()).toBe('28.70419, 80.56578');
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

  it('permissions: parameters hidden without vehicle.parameters.view; no panel without vehicle.details.view', async () => {
    const user = userEvent.setup();
    const { store, payloads } = setup(['live.view', 'vehicle.details.view']);
    const { unmount } = render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    expect(panel()).toHaveTextContent('Device & Comms');
    expect(screen.queryByTestId('details-param-count')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand view' }));
    expect(screen.getByRole('img', { name: 'Speed gauge' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Parameters' })).toBeNull();
    unmount();

    const other = setup(['live.view']);
    render(<VehicleDetailsPanel store={other.store} />);
    await act(() => other.store.selectVehicle(ID));
    other.payloads();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('below 1024 px it renders a bottom sheet', async () => {
    mockDesktop(false);
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    const sheet = screen.getByRole('dialog', { name: 'Vehicle details' });
    expect(sheet).toHaveAttribute('data-snap', '0.35');
    expect(within(sheet).getByTestId('details-regno')).toHaveTextContent('P6DED30BPDC002607');
  });
});

describe('F07-T5: live updates re-render only changed parameter cells', () => {
  it('one PID changed → only that cell renders again', async () => {
    const user = userEvent.setup();
    const renders = new Map<string, number>();
    const onCellRender = (pid: string) => renders.set(pid, (renders.get(pid) ?? 0) + 1);
    const { store, payloads } = setup();
    render(<VehicleDetailsPanel store={store} onCellRender={onCellRender} />);
    await act(() => store.selectVehicle(ID));
    payloads();
    await user.click(screen.getByRole('button', { name: 'Expand view' }));
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
