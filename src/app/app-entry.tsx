import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapLiveTracking } from '@/app/bootstrap-live-tracking';
import { createAppRouter } from '@/app/router';
import { themeStore } from '@/shared/theme/theme-store';

/** The signed-in app (router, session, live tracking). Loaded by `main.tsx`. */
export function mount(root: HTMLElement) {
  // DS3-R4: applies the stored/OS theme and follows OS changes, also on screens with no toggle.
  themeStore();
  const router = createAppRouter();

  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  // The router's guards load the session; the worker starts once it is authenticated.
  bootstrapLiveTracking();
}
