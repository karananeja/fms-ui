import type { Fleet, Invite, Role, User } from '@shared/contract/index.ts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { ApiError } from '@/shared/api/api-client';
import * as api from '../api/access-api';
import { InvitesPage } from './invites-page';
import { RolesPage } from './roles-page';
import { UsersPage } from './users-page';

vi.mock('../api/access-api', () => ({
  listUsers: vi.fn(),
  listFleets: vi.fn(),
  listRoles: vi.fn(),
  listInvites: vi.fn(),
  updateUser: vi.fn(),
  createInvite: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = Date.now();
const DAY = 86_400_000;

const fleets: Fleet[] = [
  { id: 'f1', parentId: null, name: 'All India', depth: 1, vehicleCount: 10 },
  { id: 'f2', parentId: 'f1', name: 'North', depth: 2, vehicleCount: 6 },
  { id: 'f3', parentId: 'f1', name: 'South', depth: 2, vehicleCount: 4 },
  { id: 'f4', parentId: 'f2', name: 'Delhi', depth: 3, vehicleCount: 2 },
];
const roles: Role[] = [
  { id: 'r-admin', name: 'Super Admin', permissions: ['live.view', 'roles.manage'], system: true },
  { id: 'r-ops', name: 'Operator', permissions: ['live.view', 'table.view'], system: false },
];
// `fakeMe()` is user `u-1`.
const users: User[] = [
  {
    id: 'u-1',
    email: 'me@fms.local',
    name: 'Me Admin',
    roleId: 'r-admin',
    fleetIds: ['f1'],
    status: 'active',
  },
  {
    id: 'u-2',
    email: 'ops@fms.local',
    name: 'Ops User',
    roleId: 'r-ops',
    fleetIds: ['f2', 'f3', 'f4'],
    status: 'active',
  },
  {
    id: 'u-3',
    email: 'old@fms.local',
    name: 'Old User',
    roleId: 'r-ops',
    fleetIds: ['f3'],
    status: 'disabled',
  },
];
const invite = (id: string, status: Invite['status'], over: Partial<Invite> = {}): Invite => ({
  id,
  email: `${id}@fms.local`,
  roleId: 'r-ops',
  fleetIds: ['f2'],
  invitedBy: 'u-1',
  createdAt: NOW - DAY,
  expiresAt: NOW + 6 * DAY + 60_000,
  status,
  ...over,
});
const invites = [
  invite('pend', 'pending'),
  invite('exp', 'expired', { createdAt: NOW - 9 * DAY, expiresAt: NOW - 2 * DAY }),
  invite('acc', 'accepted'),
];

async function renderPage(page: ReactElement) {
  const session = await sessionAs('authenticated', fakeApi(), fakeMe());
  render(<SessionContext value={session}>{page}</SessionContext>);
}

beforeEach(() => {
  vi.mocked(api.listUsers).mockResolvedValue(users);
  vi.mocked(api.listFleets).mockResolvedValue(fleets);
  vi.mocked(api.listRoles).mockResolvedValue(roles);
  vi.mocked(api.listInvites).mockResolvedValue(invites);
});

const table = (name: string) => screen.findByRole('table', { name });
const row = async (name: string, text: string) =>
  within(await table(name))
    .getByText(text)
    .closest('tr')!;

describe('F03-T4: Users page (F03-R8)', () => {
  it('lists users with role, fleet scope (+N) and status; search and filters narrow it', async () => {
    const user = userEvent.setup();
    await renderPage(<UsersPage />);
    const ops = await row('Users', 'Ops User');
    expect(ops).toHaveTextContent('Operator');
    expect(ops).toHaveTextContent('North, South +1');
    expect(await row('Users', 'Old User')).toHaveTextContent('Disabled');

    await user.type(screen.getByLabelText('Search users'), 'old@');
    expect(screen.queryByText('Ops User')).not.toBeInTheDocument();
    expect(screen.getByText('Old User')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search users'));

    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.queryByText('Old User')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by role'), 'r-admin');
    expect(screen.queryByText('Ops User')).not.toBeInTheDocument();
    expect(screen.getByText('Me Admin')).toBeInTheDocument();
  });

  it('your own role and status are locked, with the reason', async () => {
    const user = userEvent.setup();
    await renderPage(<UsersPage />);
    await user.click(await row('Users', 'Me Admin'));
    const panel = await screen.findByRole('dialog', { name: 'Me Admin' });
    expect(within(panel).getByLabelText('Role')).toBeDisabled();
    expect(within(panel).getByText("You can't change your own role.")).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Disabled' })).toBeDisabled();
    expect(within(panel).getByText("You can't change your own status.")).toBeInTheDocument();
  });

  it('disabling a user asks for confirmation, then saves', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateUser).mockResolvedValue({ ...users[1]!, status: 'disabled' });
    await renderPage(<UsersPage />);
    await user.click(await row('Users', 'Ops User'));
    const panel = await screen.findByRole('dialog', { name: 'Ops User' });
    expect(within(panel).getByLabelText('Role')).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'Disabled' }));
    await user.click(within(panel).getByRole('button', { name: 'Save changes' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Disable Ops User?' });
    expect(confirm).toHaveTextContent('They will be signed out now.');
    expect(api.updateUser).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Disable' }));
    expect(api.updateUser).toHaveBeenCalledWith('u-2', { status: 'disabled' });
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByText('Disabled')).toHaveLength(2),
    );
  });

  it('a fleet scope change is saved without a confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateUser).mockResolvedValue({ ...users[1]!, fleetIds: ['f3', 'f4'] });
    await renderPage(<UsersPage />);
    await user.click(await row('Users', 'Ops User'));
    const panel = await screen.findByRole('dialog', { name: 'Ops User' });
    // Delhi is implied by North (F03-R7), so deselect North itself.
    await user.click(within(panel).getByRole('checkbox', { name: /North/ }));
    await user.click(within(panel).getByRole('button', { name: 'Save changes' }));
    expect(api.updateUser).toHaveBeenCalledWith('u-2', { fleetIds: ['f3', 'f4'] });
  });
});

describe('F03-T4: Invites page (F03-R9)', () => {
  it('shows pending by default; other statuses on filter', async () => {
    const user = userEvent.setup();
    await renderPage(<InvitesPage />);
    const t = await table('Invites');
    await waitFor(() => expect(within(t).getByText('pend@fms.local')).toBeInTheDocument());
    expect(within(t).queryByText('exp@fms.local')).not.toBeInTheDocument();
    expect(t).toHaveTextContent(/in 6 d.*IST/);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(within(t).getByText('exp@fms.local')).toBeInTheDocument();
    expect(within(t).getByText('acc@fms.local')).toBeInTheDocument();
  });

  it('invite dialog validates, and a 409 shows on the email field', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createInvite).mockRejectedValue(
      new ApiError(409, 'conflict', 'A pending invite already exists for this email'),
    );
    await renderPage(<InvitesPage />);
    await table('Invites');
    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite user' });
    await user.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a role.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose at least one fleet.')).toBeInTheDocument();
    expect(api.createInvite).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Email'), 'pend@fms.local');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'r-ops');
    await user.click(within(dialog).getByRole('checkbox', { name: /North/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(api.createInvite).toHaveBeenCalledWith({
      email: 'pend@fms.local',
      roleId: 'r-ops',
      fleetIds: ['f2'],
    });
    const email = within(dialog).getByLabelText('Email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(email).toHaveAccessibleDescription('A pending invite already exists for this email');
  });

  it('resend works for pending and expired; revoke (pending only) asks first', async () => {
    const user = userEvent.setup();
    vi.mocked(api.resendInvite).mockResolvedValue(invite('exp', 'pending'));
    vi.mocked(api.revokeInvite).mockResolvedValue(undefined);
    await renderPage(<InvitesPage />);
    await table('Invites');
    await user.click(screen.getByRole('button', { name: /^Expired/ }));
    expect(screen.queryByRole('button', { name: 'Revoke invite to exp@fms.local' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resend invite to exp@fms.local' }));
    expect(api.resendInvite).toHaveBeenCalledWith('exp');

    await user.click(screen.getByRole('button', { name: /^Pending/ }));
    expect(screen.getByRole('button', { name: 'Resend invite to pend@fms.local' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Revoke invite to pend@fms.local' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revoke this invite?' });
    expect(api.revokeInvite).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    expect(api.revokeInvite).toHaveBeenCalledWith('pend');
    await waitFor(() => expect(screen.queryByText('pend@fms.local')).not.toBeInTheDocument());
  });
});

describe('F03-T4: Roles page (F03-R10)', () => {
  it('lists permission and user counts', async () => {
    await renderPage(<RolesPage />);
    const ops = await row('Roles', 'Operator');
    await waitFor(() => expect(ops).toHaveTextContent('2 / 18'));
    expect(within(ops).getAllByRole('cell')[2]).toHaveTextContent('2');
  });

  it('system roles are read-only', async () => {
    const user = userEvent.setup();
    await renderPage(<RolesPage />);
    await user.click(await row('Roles', 'Super Admin'));
    const panel = await screen.findByRole('dialog', { name: 'Super Admin' });
    expect(within(panel).getByText('System roles are read-only.')).toBeInTheDocument();
    for (const box of within(panel).getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: /Save|Delete/ })).toBeNull();
  });

  it('custom roles: users.invite / roles.manage locked with the reason; save sends the set', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateRole).mockResolvedValue({ ...roles[1]!, permissions: ['live.view'] });
    await renderPage(<RolesPage />);
    await user.click(await row('Roles', 'Operator'));
    const panel = await screen.findByRole('dialog', { name: 'Operator' });
    expect(within(panel).getByRole('checkbox', { name: 'Invite users' })).toBeDisabled();
    expect(within(panel).getByRole('checkbox', { name: 'Manage roles' })).toBeDisabled();
    expect(within(panel).getByRole('checkbox', { name: 'Manage users' })).toBeEnabled();
    expect(
      within(panel).getByText('Only Super Admin can invite users or manage roles.'),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole('checkbox', { name: 'View table' }));
    await user.click(within(panel).getByRole('button', { name: 'Save changes' }));
    expect(api.updateRole).toHaveBeenCalledWith('r-ops', {
      name: 'Operator',
      permissions: ['live.view'],
    });
  });

  it('delete is blocked while in use: the server 409 is shown', async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteRole).mockRejectedValue(
      new ApiError(409, 'conflict', 'Role is assigned to users or pending invites'),
    );
    await renderPage(<RolesPage />);
    await user.click(await row('Roles', 'Operator'));
    const panel = await screen.findByRole('dialog', { name: 'Operator' });
    await user.click(within(panel).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Operator?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(api.deleteRole).toHaveBeenCalledWith('r-ops');
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Role is assigned to users or pending invites',
    );
    expect(screen.getByRole('dialog', { name: 'Operator' })).toBeInTheDocument();
  });
});
