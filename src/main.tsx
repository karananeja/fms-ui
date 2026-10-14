import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { bootstrapLiveTracking } from '@/app/bootstrap-live-tracking';
import { createAppRouter } from '@/app/router';
import './index.css';

const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// The router's guards load the session; the worker starts once it is authenticated.
bootstrapLiveTracking();
