import type { Permission, ShareLink } from '@shared/contract/index.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { ApiError } from '@/shared/api/api-client';
import { Toaster } from '@/shared/ui/sonner';
import * as api from '../api/share-api';
import { ShareDialog } from './share-dialog';

vi.mock('../api/share-api', () => ({
  createShareLink: vi.fn(),
  listShareLinks: vi.fn(),
  revokeShareLink: vi.fn(),
}));
vi.mock('@/features/access/api/access-api', () => ({
  listUsers: vi.fn(async () => [
    { id: 'u-2', email: 'o@x', name: 'Other User', roleId: 'r', fleetIds: [], status: 'active' },
  ]),
}));

const MIN = 60_000;
const HOUR = 60 * MIN;
// 14 Oct 2026, 12:00 pm IST.
const NOW = Date.UTC(2026, 9, 14, 6, 30);
const VEHICLE = 'bgauss_c12_in_7';

const link = (id: string, over: Partial<ShareLink> = {}): ShareLink => ({
  id,
  token: `tok-${id}`,
  vehicleId: VEHICLE,
  createdBy: 'u-1',
  createdAt: NOW - HOUR,
  expiresAt: NOW + 5 * HOUR,
  show: { drivingEnergy: false, device: false },
  trail: { enabled: false, windowMinutes: 60 },
  url: `/share/tok-${id}`,
  ...over,
});

const LINKS = [
  link('mine'),
  link('other', {
    createdBy: 'u-2',
    createdAt: NOW - 2 * HOUR,
    show: { drivingEnergy: true, device: true },
    trail: { enabled: true, windowMinutes: 60 },
  }),
  link('expired', { createdAt: NOW - 3 * HOUR, expiresAt: NOW - HOUR }),
  link('revoked', { createdAt: NOW - 4 * HOUR, revokedAt: NOW - 2 * HOUR }),
];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.mocked(api.listShareLinks).mockResolvedValue(LINKS);
  vi.mocked(api.revokeShareLink).mockResolvedValue(undefined);
  vi.mocked(api.createShareLink).mockImplementation(async (input) =>
    link('new', { ...input, createdAt: NOW }),
  );
});

async function renderDialog(permissions: Permission[] = ['share.create', 'share.revoke']) {
  const user = userEvent.setup();
  const session = await sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'Me', permissions));
  render(
    <SessionContext value={session}>
      <ShareDialog open onOpenChange={() => {}} vehicleId={VEHICLE} regno="KA01AB1234" />
      <Toaster />
    </SessionContext>,
  );
  await screen.findByRole('dialog', { name: 'Share live location' });
  return user;
}

const pressed = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);

describe('F10-T2: share dialog', () => {
  it('defaults: 24 h, location only, trail off; the resolved expiry in IST', async () => {
    await renderDialog();
    expect(screen.getByRole('dialog')).toHaveTextContent('KA01AB1234');
    expect(pressed('Expiry')).toEqual(['24 h']);
    expect(screen.getByTestId('share-expiry-note')).toHaveTextContent(
      'Expires 15 Oct, 12:00 pm IST',
    );
    const location = screen.getByRole('checkbox', { name: /Location/ });
    expect(location).toBeChecked();
    expect(location).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Driving · energy/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Driving · energy/ })).toHaveAccessibleDescription(
      /^Speed, SOC, range, odometer/,
    );
    expect(screen.getByRole('checkbox', { name: /Device/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Device/ })).toHaveAccessibleDescription(
      'Signal, device battery, car battery, device ID',
    );
    expect(screen.getByRole('checkbox', { name: /Show trail/ })).not.toBeChecked();
    expect(screen.queryByRole('group', { name: 'Trail window' })).toBeNull();
  });

  it('create sends the exact body (defaults)', async () => {
    const user = await renderDialog();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(api.createShareLink).toHaveBeenCalledWith({
      vehicleId: VEHICLE,
      expiresAt: NOW + 24 * HOUR,
      show: { drivingEnergy: false, device: false },
      trail: { enabled: false, windowMinutes: 60 },
    });
  });

  it('create sends the chosen options; result shows the URL, copy, open, create another', async () => {
    const user = await renderDialog();
    await user.click(screen.getByRole('button', { name: '7 days' }));
    await user.click(screen.getByRole('checkbox', { name: /Driving · energy/ }));
    await user.click(screen.getByRole('checkbox', { name: /Show trail/ }));
    expect(pressed('Trail window')).toEqual(['1 h']);
    await user.click(
      within(screen.getByRole('group', { name: 'Trail window' })).getByRole('button', {
        name: '6 h',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(api.createShareLink).toHaveBeenCalledWith({
      vehicleId: VEHICLE,
      expiresAt: NOW + 7 * 24 * HOUR,
      show: { drivingEnergy: true, device: false },
      trail: { enabled: true, windowMinutes: 360 },
    });

    const url = `${window.location.origin}/share/tok-new`;
    expect(await screen.findByRole('textbox', { name: 'Share link URL' })).toHaveValue(url);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', url);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('target', '_blank');

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(url);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    // The new link counts in the Links tab at once.
    expect(screen.getByRole('tab', { name: /Links/ })).toHaveTextContent('Links3');

    await user.click(screen.getByRole('button', { name: 'Create another' }));
    expect(screen.getByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  it('custom expiry: IST inputs, inline errors, create disabled while invalid', async () => {
    const user = await renderDialog();
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const date = screen.getByLabelText('Expiry date (IST)');
    const time = screen.getByLabelText('Expiry time (IST)');
    expect(date).toHaveValue('2026-10-15');
    expect(time).toHaveValue('12:00');

    await user.clear(time);
    await user.type(time, '12:03');
    await user.clear(date);
    await user.type(date, '2026-10-14');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a time at least 5 min from now.');
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();

    await user.clear(date);
    await user.type(date, '2026-11-20');
    expect(screen.getByRole('alert')).toHaveTextContent('Links can last at most 30 days.');

    await user.clear(date);
    await user.type(date, '2026-10-20');
    await user.clear(time);
    await user.type(time, '18:30');
    expect(screen.getByTestId('share-expiry-note')).toHaveTextContent(
      'Expires 20 Oct, 6:30 pm IST',
    );
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(vi.mocked(api.createShareLink).mock.calls[0]![0].expiresAt).toBe(
      Date.UTC(2026, 9, 20, 13, 0),
    );
  });

  it('server errors show inline (422, 403)', async () => {
    const user = await renderDialog();
    vi.mocked(api.createShareLink).mockRejectedValueOnce(
      new ApiError(422, 'validation_failed', 'expiresAt must be in the future'),
    );
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expiresAt must be in the future');
    vi.mocked(api.createShareLink).mockRejectedValueOnce(
      new ApiError(403, 'forbidden', 'Vehicle not in scope'),
    );
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't share this vehicle.");
  });

  it('Links tab: count, statuses, chips, creator; inactive collapsed; revoke with confirm', async () => {
    const user = await renderDialog(['share.create', 'share.revoke', 'users.manage']);
    expect(api.listShareLinks).toHaveBeenCalledWith({ vehicleId: VEHICLE }, expect.anything());
    const tab = screen.getByRole('tab', { name: /Links/ });
    await vi.waitFor(() => expect(tab).toHaveTextContent('Links2'));
    await user.click(tab);

    const active = screen.getByRole('list', { name: 'Active links' });
    const rows = within(active)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.linkId);
    expect(rows.map((r) => r.dataset.linkId)).toEqual(['mine', 'other']);
    expect(rows[0]).toHaveTextContent(/Expires in 5 h/);
    expect(rows[0]).toHaveTextContent('14 Oct, 5:00 pm IST');
    expect(rows[0]).toHaveTextContent('by You');
    expect(within(rows[1]!).getByRole('list', { name: 'Shared data' })).toHaveTextContent(
      /Location.*Driving.*Device.*Trail 1 h/,
    );
    await vi.waitFor(() => expect(rows[1]).toHaveTextContent('by Other User'));

    // Inactive rows are collapsed.
    expect(screen.queryByRole('list', { name: 'Inactive links' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show 2 inactive' }));
    const inactive = within(screen.getByRole('list', { name: 'Inactive links' }));
    expect(
      inactive
        .getAllByRole('listitem')
        .filter((li) => li.dataset.linkId)
        .map((r) => r.dataset.status),
    ).toEqual(['expired', 'revoked']);
    expect(inactive.queryByRole('button', { name: 'Revoke link' })).toBeNull();

    // Revoke (share.revoke: any active link) with confirmation.
    expect(within(active).getAllByRole('button', { name: 'Revoke link' })).toHaveLength(2);
    await user.click(within(rows[1]!).getByRole('button', { name: 'Revoke link' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Revoke this link?' });
    expect(confirm).toHaveTextContent('Anyone with this link loses access now.');
    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    expect(api.revokeShareLink).toHaveBeenCalledWith('other');
    await vi.waitFor(() => expect(tab).toHaveTextContent('Links1'));
    expect(await screen.findByText('Link revoked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide 3 inactive' })).toBeInTheDocument();
  });

  it('without share.revoke: revoke only on your own links, no creator shown', async () => {
    const user = await renderDialog(['share.create']);
    await user.click(screen.getByRole('tab', { name: /Links/ }));
    const active = await screen.findByRole('list', { name: 'Active links' });
    const [mine, other] = within(active)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.linkId);
    expect(within(mine!).getByRole('button', { name: 'Revoke link' })).toBeInTheDocument();
    expect(within(other!).queryByRole('button', { name: 'Revoke link' })).toBeNull();
    expect(active).not.toHaveTextContent(/by /);

    await user.click(within(mine!).getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/share/tok-mine`);
  });
});

describe('F10-T2: copy failure', () => {
  it('a failed copy says so', async () => {
    const user = await renderDialog();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    await screen.findByRole('textbox', { name: 'Share link URL' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await act(() => user.click(screen.getByRole('button', { name: 'Copy' })));
    expect(await screen.findByText('Could not copy the link')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
