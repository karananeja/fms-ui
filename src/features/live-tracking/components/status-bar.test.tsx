import type { Fleet, Me } from '@shared/contract/index.ts';
import { VEHICLE_STATUSES } from '@shared/domain/vehicle-status.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { releaseProxy, type Remote } from 'comlink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTrackingStore } from '../store/live-tracking-store';
import type {
  FilterOptions,
  LivePush,
  LiveTrackingWorkerApi,
  Suggestion,
  VehicleFilter,
} from '../worker/worker-api';
import {
  applyDraft,
  draftFrom,
  filterChips,
  fitCount,
  MORE_WIDTH,
  scopeLabel,
} from '../lib/status-bar-model';
import { ActiveFilterChips } from './active-filter-chips';
import { FilterPanel } from './filter-panel';
import { FleetPulseCard } from './fleet-pulse-card';
import { SearchBox } from './search-box';
import { StatusPills } from './status-pills';

const counts = (over: Partial<LivePush['statusCounts']> = {}) => ({
  ...(Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as LivePush['statusCounts']),
  ...over,
});
const FLEETS: Fleet[] = [
  { id: 'f0', parentId: null, name: 'North', depth: 1, vehicleCount: 10 },
  { id: 'f1', parentId: 'f0', name: 'Delhi', depth: 2, vehicleCount: 6 },
  { id: 'f2', parentId: null, name: 'South', depth: 1, vehicleCount: 4 },
];
const OPTIONS: FilterOptions = {
  assetTypes: ['Bus', 'Car'],
  fuelTypes: ['CNG', 'Electric'],
  makes: ['Ola', 'Tata'],
  models: [
    { make: 'Tata', model: 'Ultra' },
    { make: 'Ola', model: 'S1' },
  ],
};
const SUGGESTIONS: Suggestion[] = [
  {
    vehicleId: 'v1',
    regno: 'KA01AB0001',
    vin: 'VIN1',
    deviceId: 'd1',
    status: 'running',
    matchedField: 'regno',
  },
  {
    vehicleId: 'v2',
    regno: 'KA01AB0002',
    vin: 'VIN2',
    deviceId: 'd2',
    status: 'stopped',
    matchedField: 'regno',
  },
];

function setup() {
  let onPush: (p: LivePush) => void = () => {};
  const api = {
    init: vi.fn(async (_me: Me, cb: (p: LivePush) => void) => {
      onPush = cb;
    }),
    selectVehicle: vi.fn(async () => true),
    getVehicleSummary: vi.fn(async () => ({ vehicleId: 'v1', lat: 12, lng: 77 })),
    setViewport: vi.fn(async () => null),
    getBounds: vi.fn(async () => null),
    getClusterExpansionZoom: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
    setFilter: vi.fn<(f: VehicleFilter) => Promise<void>>(async () => {}),
    setFleets: vi.fn(async () => {}),
    suggest: vi.fn(async (prefix: string) =>
      SUGGESTIONS.filter((s) => s.regno.startsWith(prefix.toUpperCase())),
    ),
    getFilterOptions: vi.fn(async () => OPTIONS),
    [releaseProxy]: vi.fn(),
  };
  const store = new LiveTrackingStore({
    createWorkerApi: () => api as unknown as Remote<LiveTrackingWorkerApi>,
    fetchTrail: async () => [],
    fetchFleets: async () => FLEETS,
  });
  store.start({
    fleetIds: ['f0'],
    permissions: ['live.view', 'vehicle.details.view'],
  } as unknown as Me);
  const push = (filteredCounts: LivePush['statusCounts'], filteredTotal: number) =>
    act(() =>
      onPush({
        connection: 'live',
        stats: { ...store.getSnapshot().stats, snapshotComplete: true },
        version: 1,
        statusCounts: filteredCounts,
        total: filteredTotal,
        filteredCounts,
        filteredTotal,
        selectedMatches: true,
      }),
    );
  return { api, store, push };
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

beforeEach(() => {
  mockDesktop();
  // Radix popper measures its anchor; jsdom has no ResizeObserver.
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

describe('F08-T6: search box', () => {
  it('type → suggestions; arrows + Enter locate the vehicle', async () => {
    const { api, store } = setup();
    const locate = vi.spyOn(store, 'locateVehicle');
    render(<SearchBox store={store} />);
    const box = screen.getByRole('combobox', { name: 'Search vehicles' });
    await userEvent.type(box, 'ka01');
    const list = await screen.findByRole('listbox', { name: 'Vehicle suggestions' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    expect(api.suggest).toHaveBeenLastCalledWith('ka01', 'all', 8);
    expect(box).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const second = within(list).getAllByRole('option')[1]!;
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', second.id);
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(locate).toHaveBeenCalledWith('v1');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter without a highlighted suggestion applies the prefix as a filter; Esc closes', async () => {
    const { store } = setup();
    render(<SearchBox store={store} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'ka01');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box).toHaveValue('ka01');
    await userEvent.keyboard('{Enter}');
    expect(store.getSnapshot().filter).toEqual({ search: { field: 'all', prefix: 'ka01' } });
    expect(box).toHaveValue('');
  });

  it('shows a hint when nothing matches, and / focuses the box', async () => {
    const { store } = setup();
    render(<SearchBox store={store} />);
    await userEvent.keyboard('/');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await userEvent.keyboard('zz');
    expect(await screen.findByText(/No vehicles match/)).toBeInTheDocument();
  });
});

describe('F08-T6: status pills', () => {
  it('pills show filtered counts; clicking toggles statuses; ALL clears', async () => {
    const { store, push } = setup();
    render(<StatusPills store={store} />);
    push(counts({ running: 34646, stopped: 100 }), 34746);
    expect(screen.getByRole('button', { name: 'All: 34,746' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const running = screen.getByRole('button', { name: 'Running: 34,646' });
    await userEvent.click(running);
    await userEvent.click(screen.getByRole('button', { name: 'Charging: 0' }));
    expect(store.getSnapshot().filter.statuses).toEqual(['running', 'charging']);
    expect(running).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(store.getSnapshot().filter).toEqual({});
  });

  it('fitCount keeps ALL, fits what it can and leaves room for +N', () => {
    const widths = [90, 120, 120, 120, 120];
    const all = widths.reduce((a, w) => a + w, 0) + 6 * 4;
    expect(fitCount(widths, all)).toBe(4);
    // 90+6+52 + 3×(120+6) = 526 ≤ 593; a 4th would need 652.
    expect(fitCount(widths, all - 1)).toBe(3);
    expect(fitCount(widths, 90 + 6 + MORE_WIDTH)).toBe(0);
  });

  it('mobile shows compact counts', () => {
    mockDesktop(false);
    const { store, push } = setup();
    render(<StatusPills store={store} />);
    push(counts({ running: 34646 }), 34646);
    expect(screen.getByRole('button', { name: 'Running: 34,646' })).toHaveTextContent('34.6K');
  });
});

describe('F08-T6: filter panel', () => {
  it('produces the expected filter from fleets, types, make/model and keeps statuses + search', async () => {
    const { store } = setup();
    store.setFilter({ statuses: ['running'], search: { field: 'regno', prefix: 'KA' } });
    render(<FilterPanel store={store} />);
    await act(async () => {}); // fleets load
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = await screen.findByRole('form', { name: 'Vehicle filters' });
    await userEvent.click(within(panel).getByRole('checkbox', { name: /North/ }));
    // A child of a chosen fleet is included and can't be toggled on its own.
    expect(within(panel).getByRole('checkbox', { name: /Delhi/ })).toBeDisabled();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Bus' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Tata' }));
    // Models are narrowed by the chosen make.
    expect(within(panel).queryByRole('button', { name: 'S1' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Ultra' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    expect(store.getSnapshot().filter).toEqual({
      statuses: ['running'],
      fleetIds: ['f0'],
      assetTypes: ['Bus'],
      makes: ['Tata'],
      models: ['Ultra'],
      search: { field: 'regno', prefix: 'KA' },
    });
    expect(screen.getByRole('button', { name: 'Filters (4 active)' })).toBeInTheDocument();
  });

  it('applyDraft drops models outside the chosen makes and full SOC range is no filter', () => {
    const d = {
      ...draftFrom({}),
      makes: ['Ola'],
      models: ['Ultra', 'S1'],
      soc: [20, 80] as [number, number],
    };
    expect(applyDraft({}, d, OPTIONS)).toMatchObject({
      makes: ['Ola'],
      models: ['S1'],
      socMin: 20,
      socMax: 80,
    });
  });

  it('opens as a bottom sheet on mobile', async () => {
    mockDesktop(false);
    const { store } = setup();
    render(<FilterPanel store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByRole('form', { name: 'Vehicle filters' })).toBeInTheDocument();
    expect(document.querySelector('[data-filter-panel="sheet"]')).not.toBeNull();
  });
});

describe('F08-T6: active filter chips', () => {
  it('one chip per value; removing one keeps the rest; Clear all empties', async () => {
    const { store } = setup();
    render(<ActiveFilterChips store={store} />);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    await act(async () => {
      store.setFilter({
        statuses: ['charging'],
        fleetIds: ['f1'],
        assetTypes: ['Bus'],
        socMin: 20,
        socMax: 60,
        search: { field: 'regno', prefix: 'ka01' },
      });
    });
    const list = screen.getByRole('list', { name: 'Active filters' });
    expect(
      within(list)
        .getAllByRole('button', { name: /^Remove/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Remove Charging',
      'Remove Fleet: Delhi',
      'Remove Type: Bus',
      'Remove SOC 20–60%',
      'Remove Reg: KA01…',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove SOC 20–60%' }));
    expect(store.getSnapshot().filter).toEqual({
      statuses: ['charging'],
      fleetIds: ['f1'],
      assetTypes: ['Bus'],
      search: { field: 'regno', prefix: 'ka01' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(store.getSnapshot().filter).toEqual({});
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(filterChips({}, new Map())).toEqual([]);
  });
});

describe('F08-R10: fleet pulse card', () => {
  it('total, legend and scope; "Collecting…" until two samples', async () => {
    const { store, push } = setup();
    render(<FleetPulseCard store={store} />);
    push(counts({ running: 6, stopped: 4 }), 10);
    expect(screen.getByTestId('pulse-total')).toHaveTextContent('10');
    expect(screen.getByTestId('pulse-scope')).toHaveTextContent('All fleets');
    expect(screen.getByTestId('pulse-collecting')).toBeInTheDocument();
    await act(async () => store.patchFilter({ statuses: ['running'] }));
    // Stopped is outside the status filter, so the legend shows 0 for it.
    expect(
      within(screen.getByTestId('fleet-pulse')).getByText('Stopped').nextSibling,
    ).toHaveTextContent('0');
    expect(scopeLabel(['f1'], new Map([['f1', 'Delhi']]))).toBe('Delhi');
    expect(scopeLabel(['f1', 'f2'], new Map())).toBe('2 fleets');
  });
});
