import { PERMISSIONS, type Assignment, type Driver, type Fleet } from '@shared/contract/index.ts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { DriverSection } from '@/features/live-tracking/components/driver-section';
import { ApiError } from '@/shared/api/api-client';
import * as api from './api/drivers-api';
import { AssignDialog } from './components/assign-dialog';
import { DriverForm } from './components/driver-form';
import { CurrentAssignments } from './lib/current-assignments';
import { validateDriver } from './lib/driver-format';
import { emitAssignment } from './use-assignment-events';

vi.mock('./api/drivers-api', () => ({
  listDrivers: vi.fn(),
  createDriver: vi.fn(),
  updateDriver: vi.fn(),
  assignVehicle: vi.fn(),
  unassignDriver: vi.fn(),
  reassignVehicle: vi.fn(),
  driverAssignments: vi.fn(),
  vehicleAssignments: vi.fn(),
  vehicleDriver: vi.fn(),
  searchVehicles: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = Date.now();
const DAY = 86_400_000;
const fleets: Fleet[] = [
  { id: 'f1', parentId: null, name: 'All India', depth: 1, vehicleCount: 3 },
];
const driver = (id: string, name: string, over: Partial<Driver> = {}): Driver => ({
  id,
  userId: null,
  name,
  phone: '+91 98765 43210',
  fleetId: 'f1',
  status: 'active',
  createdAt: NOW - 30 * DAY,
  ...over,
});
const ravi = driver('d1', 'Ravi Kumar');
const anita = driver('d2', 'Anita Rao');
const open = (driverId: string, vehicleId: string, from = NOW - 3 * DAY): Assignment => ({
  id: `a-${driverId}`,
  driverId,
  vehicleId,
  from,
  to: null,
  by: 'u-1',
});

const VIEWER = PERMISSIONS.filter((p) => p !== 'drivers.manage');

async function renderAs(ui: ReactElement, permissions = [...PERMISSIONS]) {
  const session = await sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'Me', permissions));
  return render(<SessionContext value={session}>{ui}</SessionContext>);
}

beforeEach(() => {
  vi.mocked(api.vehicleDriver).mockResolvedValue(null);
  vi.mocked(api.vehicleAssignments).mockResolvedValue([]);
});

describe('F12-T2: driver form validation (F12-R2)', () => {
  it('checks name, +91 phone, fleet and the invite email', () => {
    expect(
      validateDriver({ name: ' ', phone: '123', fleetId: null, invite: true, email: 'x' }),
    ).toEqual({
      name: expect.any(String),
      phone: expect.stringContaining('+91'),
      fleet: expect.any(String),
      email: expect.any(String),
    });
    // Ten digits are normalised to `+91 9xxxx xxxxx`.
    expect(
      validateDriver({ name: 'A', phone: '9876543210', fleetId: 'f1', invite: false, email: '' }),
    ).toEqual({});
  });

  it('shows errors inline, then creates with the invite and shows server errors', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(api.createDriver)
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'Phone already in use'))
      .mockResolvedValueOnce(ravi);
    await renderAs(
      <DriverForm driver={null} fleets={fleets} onSaved={onSaved} onCancel={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Add driver' }));
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(/name/);
    expect(api.createDriver).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Name'), 'Ravi Kumar');
    await user.type(screen.getByLabelText('Phone'), '9876543210');
    await user.click(screen.getByLabelText('Send app invite'));
    await user.type(screen.getByLabelText('Invite email'), 'ravi@fms.local');
    await user.click(screen.getByRole('button', { name: 'Add driver' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phone already in use');

    await user.click(screen.getByRole('button', { name: 'Add driver' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(ravi, true));
    expect(api.createDriver).toHaveBeenLastCalledWith({
      name: 'Ravi Kumar',
      phone: '+91 98765 43210',
      fleetId: 'f1',
      status: 'active',
      invite: true,
      email: 'ravi@fms.local',
    });
  });
});

describe('F12-T2: assign dialog (F12-R3)', () => {
  it('warns when the vehicle already has a driver and reassigns on confirm', async () => {
    const user = userEvent.setup();
    const onAssigned = vi.fn();
    vi.mocked(api.listDrivers).mockResolvedValue({ items: [anita], nextCursor: null });
    vi.mocked(api.reassignVehicle).mockResolvedValue(open('d2', 'v1', NOW));
    await renderAs(
      <AssignDialog
        open
        onOpenChange={vi.fn()}
        target={{
          mode: 'driver',
          vehicle: { vehicleId: 'v1', regno: 'MH12AB1234', fleetId: 'f1' },
          currentDriver: ravi,
        }}
        onAssigned={onAssigned}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Anita Rao/ }));
    expect(await screen.findByTestId('assign-conflict')).toHaveTextContent(
      'MH12AB1234 is driven by Ravi K. Reassign?',
    );
    await user.click(screen.getByRole('button', { name: 'Reassign' }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(api.reassignVehicle).toHaveBeenCalledWith('d2', 'v1', 'd1');
    // The previous driver's assignment is echoed as closed.
    expect(onAssigned.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ driverId: 'd1', vehicleId: 'v1', to: NOW }),
    ]);
  });

  it('shows a 409 from the server inline', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listDrivers).mockResolvedValue({ items: [anita], nextCursor: null });
    vi.mocked(api.reassignVehicle).mockRejectedValue(
      new ApiError(409, 'conflict', 'Vehicle already has a driver'),
    );
    await renderAs(
      <AssignDialog
        open
        onOpenChange={vi.fn()}
        target={{
          mode: 'driver',
          vehicle: { vehicleId: 'v1', regno: 'MH12AB1234', fleetId: 'f1' },
          currentDriver: null,
        }}
        onAssigned={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /Anita Rao/ }));
    expect(screen.queryByTestId('assign-conflict')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vehicle already has a driver');
  });
});

describe('F12-T2: vehicle card driver section (F12-R5)', () => {
  const section = <DriverSection vehicleId="v1" regno="MH12AB1234" fleetId="f1" />;

  it('none: "No driver assigned" with Assign for drivers.manage', async () => {
    await renderAs(section);
    expect(await screen.findByTestId('driver-none')).toHaveTextContent('No driver assigned');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  it('assigned (manage): name, tel: phone, since, Change / Unassign', async () => {
    vi.mocked(api.vehicleDriver).mockResolvedValue(ravi);
    vi.mocked(api.vehicleAssignments).mockResolvedValue([open('d1', 'v1')]);
    await renderAs(section);
    expect(await screen.findByTestId('driver-name')).toHaveTextContent('Ravi Kumar');
    expect(screen.getByRole('link', { name: 'Call Ravi Kumar' })).toHaveAttribute(
      'href',
      'tel:+919876543210',
    );
    expect(screen.getByTestId('driver-since')).toHaveTextContent('since 3 d');
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeInTheDocument();
  });

  it('read-only without drivers.manage', async () => {
    vi.mocked(api.vehicleDriver).mockResolvedValue(ravi);
    vi.mocked(api.vehicleAssignments).mockResolvedValue([open('d1', 'v1')]);
    await renderAs(section, VIEWER);
    expect(await screen.findByTestId('driver-name')).toHaveTextContent('Ravi Kumar');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('updates live on an assignment event for the vehicle', async () => {
    await renderAs(section, VIEWER);
    await screen.findByTestId('driver-none');
    vi.mocked(api.vehicleDriver).mockResolvedValue(anita);
    vi.mocked(api.vehicleAssignments).mockResolvedValue([open('d2', 'v1')]);
    emitAssignment(open('d2', 'v1'));
    expect(await screen.findByTestId('driver-name')).toHaveTextContent('Anita Rao');
  });
});

describe('F12-R1: current assignments for the drivers table', () => {
  it('loads only requested drivers, once, and reloads on an event', async () => {
    const load = vi.fn(async (id: string) => (id === 'd1' ? [open('d1', 'v1')] : []));
    const store = new CurrentAssignments(load, async (v) => `REG-${v}`);
    const off = store.subscribe(() => {});
    store.request(['d1', 'd2']);
    store.request(['d1']);
    await waitFor(() => expect(store.get('d2')).toBeNull());
    expect(store.get('d1')).toEqual({ assignment: open('d1', 'v1'), regno: 'REG-v1' });
    expect(load).toHaveBeenCalledTimes(2);

    emitAssignment({ ...open('d1', 'v1'), to: NOW });
    expect(store.get('d1')).toBeUndefined();
    store.request(['d1']);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    off();
  });
});
