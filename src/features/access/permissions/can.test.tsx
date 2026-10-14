import { PERMISSIONS, type Permission } from '@shared/contract/index.ts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import type { SessionStore } from '@/features/auth/session/session-store';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { ADMIN_PERMISSIONS, can, firstAllowedPath, useCan } from './can';
import { RequirePermission } from './require-permission';

const holder = (...permissions: Permission[]) => ({ permissions });
const signedInAs = (...permissions: Permission[]) =>
  sessionAs('authenticated', fakeApi(), fakeMe('u-1', 'Tester', permissions));

describe('F03-R1: can', () => {
  it('checks one permission', () => {
    expect(can(holder('live.view'), 'live.view')).toBe(true);
    expect(can(holder('live.view'), 'table.export')).toBe(false);
  });

  it('a list means any of them', () => {
    expect(can(holder('roles.manage'), ADMIN_PERMISSIONS)).toBe(true);
    expect(can(holder('live.view', 'table.view'), ADMIN_PERMISSIONS)).toBe(false);
    expect(can(holder('live.view'), [])).toBe(false);
  });

  it('signed out can do nothing', () => {
    expect(can(null, 'live.view')).toBe(false);
    expect(can(undefined, ['live.view'])).toBe(false);
  });

  it('the super admin can do everything', () => {
    const me = fakeMe();
    expect(PERMISSIONS.every((p) => can(me, p))).toBe(true);
  });
});

describe('F03-R2: firstAllowedPath', () => {
  it.each<[Permission[], string | null]>([
    [[...PERMISSIONS], '/live-tracking'],
    [['live.view'], '/live-tracking'],
    [['users.invite'], '/admin'],
    [['fleets.manage', 'table.view'], '/admin'],
    [['table.view', 'table.export', 'share.create'], null],
    [[], null],
  ])('%j → %s', (permissions, path) => {
    expect(firstAllowedPath(holder(...permissions))).toBe(path);
  });

  it('signed out → null', () => expect(firstAllowedPath(null)).toBeNull());
});

describe('F03-R1: useCan', () => {
  const wrapper = (session: SessionStore) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <SessionContext value={session}>{children}</SessionContext>;
    };

  it('reads the signed-in user from the session store', async () => {
    const session = await signedInAs('live.view');
    const { result } = renderHook(() => [useCan('live.view'), useCan('roles.manage')], {
      wrapper: wrapper(session),
    });
    expect(result.current).toEqual([true, false]);
  });

  it('turns false when the session ends', async () => {
    const session = await signedInAs('live.view');
    const { result } = renderHook(() => useCan('live.view'), { wrapper: wrapper(session) });
    expect(result.current).toBe(true);
    await act(() => session.logout());
    expect(result.current).toBe(false);
  });
});

describe('F03-R1: <RequirePermission>', () => {
  /** Renders `<RequirePermission p>` at `/page` inside a router (No access has a link). */
  async function renderGuarded(session: SessionStore, p: Permission | readonly Permission[]) {
    const root = createRootRoute();
    const page = createRoute({
      getParentRoute: () => root,
      path: 'page',
      component: () => (
        <RequirePermission p={p}>
          <h1>Secret page</h1>
        </RequirePermission>
      ),
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ['/page'] }),
    });
    render(
      <SessionContext value={session}>
        <RouterProvider router={router} />
      </SessionContext>,
    );
    await act(() => router.load());
  }

  it('renders the children with the permission', async () => {
    await renderGuarded(await signedInAs('roles.manage'), 'roles.manage');
    expect(await screen.findByRole('heading', { name: 'Secret page' })).toBeInTheDocument();
  });

  it('accepts any of a list', async () => {
    await renderGuarded(await signedInAs('users.invite'), ADMIN_PERMISSIONS);
    expect(await screen.findByRole('heading', { name: 'Secret page' })).toBeInTheDocument();
  });

  it('without it: No access with a link to the first page you can open', async () => {
    await renderGuarded(await signedInAs('live.view'), 'roles.manage');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page." }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Secret page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to live tracking' })).toHaveAttribute(
      'href',
      '/live-tracking',
    );
  });

  it('with no page allowed: No access without a link', async () => {
    await renderGuarded(await signedInAs('table.view'), 'live.view');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Ask your administrator for access.')).toBeInTheDocument();
  });
});
