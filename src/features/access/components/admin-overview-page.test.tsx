import type { Permission } from '@shared/contract/index.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import * as api from '../api/access-api';
import { AdminOverviewPage } from './admin-overview-page';

vi.mock('../api/access-api', () => ({
  listUsers: vi.fn(),
  listFleets: vi.fn(),
  listRoles: vi.fn(),
  listInvites: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.listFleets).mockResolvedValue([
    { id: 'f1', parentId: null, name: 'Root', depth: 1, vehicleCount: 3 },
    { id: 'f2', parentId: 'f1', name: 'North', depth: 2, vehicleCount: 1 },
  ]);
  vi.mocked(api.listUsers).mockResolvedValue([
    { id: 'a', email: 'a@x', name: 'A', roleId: 'r', fleetIds: [], status: 'active' },
    { id: 'b', email: 'b@x', name: 'B', roleId: 'r', fleetIds: [], status: 'active' },
    { id: 'c', email: 'c@x', name: 'C', roleId: 'r', fleetIds: [], status: 'disabled' },
  ]);
  vi.mocked(api.listInvites).mockResolvedValue([]);
  vi.mocked(api.listRoles).mockResolvedValue([]);
});

async function renderOverview(permissions: Permission[]) {
  const session = await sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'T', permissions));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: 'admin',
    component: AdminOverviewPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
  });
  render(
    <SessionContext value={session}>
      <RouterProvider router={router} />
    </SessionContext>,
  );
  await act(() => router.load());
}

describe('F03-T4: admin overview (F03-R11)', () => {
  it('shows every card with counts for the super admin', async () => {
    await renderOverview(['fleets.manage', 'users.manage', 'users.invite', 'roles.manage']);
    expect(await screen.findByRole('link', { name: 'Fleets' })).toHaveTextContent('2 fleets');
    expect(await screen.findByRole('link', { name: 'Users' })).toHaveTextContent(
      '2 active · 1 disabled',
    );
    expect(screen.getByRole('link', { name: 'Pending invites' })).toHaveAttribute(
      'href',
      '/admin/invites',
    );
    expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument();
  });

  it('each card only with its permission', async () => {
    await renderOverview(['users.manage']);
    expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fleets' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pending invites' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Roles' })).toBeNull();
    expect(api.listFleets).not.toHaveBeenCalled();
  });
});
