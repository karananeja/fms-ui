import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { sessionStore } from '@/features/auth/session/session-store';
import { SessionContext } from '@/features/auth/session/use-session';
import { DriverApp } from './pages/driver-app';
import { themeStore } from '@/shared/theme/theme-store';

/** F13 / D-099: `/driver`'s own boot (no router, live-tracking store, worker, map or admin code). */
export function mount(root: HTMLElement) {
  // DS3-R4: applies the stored/OS theme and follows OS changes, also on screens with no toggle.
  themeStore();
  createRoot(root).render(
    <StrictMode>
      <SessionContext value={sessionStore}>
        <DriverApp />
      </SessionContext>
    </StrictMode>,
  );
}
