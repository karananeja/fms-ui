import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from './router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<RouterProvider router={router} />);
  return router;
}

describe('app shell', () => {
  it('renders the /live-tracking placeholder inside the layout', async () => {
    renderAt('/live-tracking');
    expect(await screen.findByRole('heading', { name: 'Live tracking' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  });

  it('redirects / to /live-tracking', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Live tracking' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/live-tracking');
  });

  it('renders auth routes without the shell', async () => {
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders the 404 page for unknown routes', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
