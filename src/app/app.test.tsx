import type { Me, Permission } from '@shared/contract/index.ts';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionContext } from '@/features/auth/session/use-session';
import { fakeApi, fakeMe, sessionAs } from '@/features/auth/testing/fake-session';
import { SessionStore } from '@/features/auth/session/session-store';
import { createAppRouter } from './router';

function renderAt(path: string, session: SessionStore) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }), session);
  render(
    <SessionContext value={session}>
      <RouterProvider router={router} />
    </SessionContext>,
  );
  return router;
}

describe('app shell', () => {
  it('renders /live-tracking inside the layout when signed in', async () => {
    renderAt('/live-tracking', await sessionAs('authenticated'));
    expect(await screen.findByRole('heading', { name: 'Live tracking' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('redirects / to /live-tracking', async () => {
    const router = renderAt('/', await sessionAs('authenticated'));
    expect(await screen.findByRole('heading', { name: 'Live tracking' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/live-tracking');
  });

  it('renders auth routes without the shell', async () => {
    renderAt('/login', await sessionAs('anonymous'));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders the 404 page for unknown routes', async () => {
    renderAt('/does-not-exist', await sessionAs('anonymous'));
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('F02-R2: route guards', () => {
  it('signed out: an app route goes to /login?redirect=<path + search>', async () => {
    const router = renderAt('/live-tracking?view=table', await sessionAs('anonymous'));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/live-tracking?view=table' });
  });

  it('signed in: /login and /forgot-password go to /live-tracking', async () => {
    const session = await sessionAs('authenticated');
    for (const path of ['/login', '/forgot-password']) {
      const router = renderAt(path, session);
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/live-tracking'));
    }
  });

  it('reset and accept-invite render in either state without probing the session', async () => {
    const api = fakeApi();
    renderAt('/reset-password', new SessionStore(api));
    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('renders no app-shell markup until the session probe resolves', async () => {
    let resolve!: (me: Me) => void;
    const session = new SessionStore(
      fakeApi({ me: vi.fn(() => new Promise<Me>((r) => (resolve = r))) }),
    );
    renderAt('/live-tracking', session);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    await act(async () => resolve(fakeMe()));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('an expiry while in the shell lands on /login?redirect=… with the notice', async () => {
    const session = await sessionAs('authenticated');
    const router = renderAt('/admin/users', session);
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    act(() => session.expire());
    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/admin/users' });
  });
});

describe('F03-R1/R2: permission guards and nav', () => {
  const signedInAs = (...permissions: Permission[]) =>
    sessionAs('authenticated', fakeApi(), fakeMe('u-2', 'Limited', permissions));
  const noAccess = { name: "You don't have access to this page." };
  const navLabels = () =>
    screen
      .queryAllByRole('link')
      .filter((a) => a.closest('nav'))
      .map((a) => a.getAttribute('aria-label'));

  it('the super admin opens every admin page and sees every nav item', async () => {
    const session = await sessionAs('authenticated');
    for (const [path, name] of [
      ['/admin', 'Admin'],
      ['/admin/fleets', 'Fleets'],
      ['/admin/users', 'Users'],
      ['/admin/invites', 'Invites'],
      ['/admin/roles', 'Roles'],
    ]) {
      renderAt(path!, session);
      expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
      expect(navLabels()).toEqual([
        'Live tracking',
        'Admin',
        'Fleets',
        'Users',
        'Invites',
        'Roles',
      ]);
      cleanup();
    }
  });

  it('a direct URL to a page without its permission shows No access', async () => {
    renderAt('/admin/roles', await signedInAs('live.view', 'users.invite'));
    expect(await screen.findByRole('heading', noAccess)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to live tracking' })).toBeInTheDocument();
    expect(navLabels()).toEqual(['Live tracking', 'Admin', 'Invites']);
  });

  it('without live.view: / lands on admin and /live-tracking shows No access', async () => {
    const session = await signedInAs('users.manage');
    const router = renderAt('/', session);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    expect(navLabels()).toEqual(['Admin', 'Users']);
    cleanup();

    renderAt('/live-tracking', session);
    expect(await screen.findByRole('heading', noAccess)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to admin' })).toHaveAttribute('href', '/admin');
  });

  it('no page allowed: / shows No access with no link and an empty nav', async () => {
    const router = renderAt('/', await signedInAs('table.view'));
    expect(await screen.findByRole('heading', noAccess)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/live-tracking');
    expect(screen.getByText('Ask your administrator for access.')).toBeInTheDocument();
    expect(navLabels()).toEqual([]);
  });

  it('/admin needs any admin permission', async () => {
    renderAt('/admin', await signedInAs('live.view', 'table.view'));
    expect(await screen.findByRole('heading', noAccess)).toBeInTheDocument();
    expect(navLabels()).toEqual(['Live tracking']);
  });
});
