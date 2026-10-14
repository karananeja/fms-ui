import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapLiveTracking } from '@/app/bootstrap-live-tracking';
import { createAppRouter } from '@/app/router';

/** The signed-in app (router, session, live tracking). Loaded by `main.tsx`. */
export function mount(root: HTMLElement) {
  const router = createAppRouter();

  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  // The router's guards load the session; the worker starts once it is authenticated.
  bootstrapLiveTracking();
}
