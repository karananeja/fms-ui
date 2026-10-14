import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { sessionStore } from '@/features/auth/session/session-store';
import { SessionContext } from '@/features/auth/session/use-session';
import { DriverApp } from './pages/driver-app';

/** F13 / D-099: `/driver`'s own boot (no router, live-tracking store, worker, map or admin code). */
export function mount(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <SessionContext value={sessionStore}>
        <DriverApp />
      </SessionContext>
    </StrictMode>,
  );
}
