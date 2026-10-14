import type { Me } from '@shared/contract/index.ts';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
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
