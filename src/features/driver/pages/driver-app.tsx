import { useEffect, useSyncExternalStore } from 'react';
import { firstAllowedPath, type PermissionHolder } from '@/features/access/permissions/can';
import { sessionStore } from '@/features/auth/session/session-store';
import { Button } from '@/shared/ui/button';
import { DriverHomePage } from './driver-home-page';

/** The Driver role: `driver.self` and no staff page (a super admin holds every permission). */
const isDriver = (me: PermissionHolder) =>
  me.permissions.includes('driver.self') && firstAllowedPath(me) === null;

function NoAccess() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6 text-center text-text">
      <div>
        <h1 className="mb-2 text-xl font-extrabold">No access</h1>
        <p className="mb-5 text-sm text-text-muted">This page is for drivers.</p>
        <Button onClick={() => location.assign('/')}>Go to the app</Button>
      </div>
    </div>
  );
}

/** F13-R1: waits for the session; signed out → `/login`, staff → No access, Driver → the page. */
export function DriverApp() {
  const state = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  useEffect(() => {
    void sessionStore.load();
  }, []);
  useEffect(() => {
    if (state.status === 'anonymous')
      location.replace(`/login?redirect=${encodeURIComponent('/driver')}`);
  }, [state.status]);
  if (state.status !== 'authenticated' || !state.me) return null;
  if (!isDriver(state.me)) return <NoAccess />;
  return <DriverHomePage />;
}
