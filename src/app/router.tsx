import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import {
  firstAllowedPath,
  ROUTE_PERMISSIONS,
  type PermissionCheck,
  type PermissionHolder,
} from '@/features/access/permissions/can';
import { sessionStore, type SessionStore } from '@/features/auth/session/session-store';
import { LiveTrackingPage } from '@/features/live-tracking/components/live-tracking-page';
import { parseLiveTrackingSearch } from '@/features/live-tracking/hooks/use-selection-url-sync';
import { AppLayout } from './app-layout';
import { NotFoundPage } from './not-found-page';

export interface RouterContext {
  session: SessionStore;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

/** F13: the Driver role (only `driver.self`, no staff page). */
export const isDriverOnly = (me: PermissionHolder | null | undefined) =>
  !!me && me.permissions.includes('driver.self') && firstAllowedPath(me) === null;

const optionalString = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/** F02-R2: `/login` and `/forgot-password` are for signed-out users only. */
async function signedOutOnly({ context }: { context: RouterContext }) {
  await context.session.load();
  if (context.session.getSnapshot().status === 'authenticated') {
    throw redirect({ to: '/', replace: true });
  }
}

// Auth and public routes render without the app shell. Auth screens are a separate chunk
// (forms + zod), so the signed-in shell doesn't carry them.
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  staticData: { title: 'Sign in' },
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => {
    const redirect = optionalString(s.redirect);
    return redirect ? { redirect } : {};
  },
  beforeLoad: signedOutOnly,
  component: lazyRouteComponent(() => import('@/features/auth/components/login-page'), 'LoginPage'),
});
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'forgot-password',
  staticData: { title: 'Forgot password' },
  beforeLoad: signedOutOnly,
  component: lazyRouteComponent(
    () => import('@/features/auth/components/forgot-password-page'),
    'ForgotPasswordPage',
  ),
});
// Reset, accept-invite and share links work signed in or not (no guard, no session probe).
const tokenSearch = (s: Record<string, unknown>): { token?: string } => {
  const token = optionalString(s.token);
  return token ? { token } : {};
};
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reset-password',
  staticData: { title: 'Reset password' },
  validateSearch: tokenSearch,
  component: lazyRouteComponent(
    () => import('@/features/auth/components/reset-password-page'),
    'ResetPasswordPage',
  ),
});
const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accept-invite',
  staticData: { title: 'Accept invite' },
  validateSearch: tokenSearch,
  component: lazyRouteComponent(
    () => import('@/features/auth/components/accept-invite-page'),
    'AcceptInvitePage',
  ),
});
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'share/$token',
  staticData: { title: 'Shared live location' },
  // F10b: its own lazy chunk (no live-tracking store, worker or admin code).
  component: lazyRouteComponent(
    () => import('@/features/share/public/public-share-route'),
    'PublicShareRoute',
  ),
});

/**
 * F02-R2: the app shell waits for the session (nothing renders meanwhile) and sends signed-out
 * users to `/login?redirect=<path + search>`.
 */
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    await context.session.load();
    if (context.session.getSnapshot().status !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    // F13-R1 / D-099: a Driver never sees the staff app; `/driver` is its own entry (full load).
    if (isDriverOnly(context.session.getSnapshot().me)) {
      window.location.replace('/driver');
      await new Promise(() => {}); // keep the shell from rendering while the page unloads
    }
  },
  component: AppLayout,
});

/**
 * F03-R2: `/` lands on the first page you can open (live tracking, then admin in nav order).
 * With none, `/live-tracking` shows No access.
 */
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    throw redirect({ to: firstAllowedPath(context.session.getSnapshot().me) ?? '/live-tracking' });
  },
});

// F03-R1/R2: each signed-in page declares its permission in `staticData.permission`;
// `AppLayout` renders the page inside `<RequirePermission>` (No access otherwise).
const liveTrackingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'live-tracking',
  staticData: { title: 'Live tracking', permission: ROUTE_PERMISSIONS['/live-tracking'] },
  validateSearch: parseLiveTrackingSearch,
  component: LiveTrackingPage,
});

// F14: the request desk; `/requests/$requestId` opens the drawer over it (one lazy chunk).
const requestsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'requests',
  staticData: { title: 'Requests', permission: ROUTE_PERMISSIONS['/requests'] },
  component: lazyRouteComponent(
    () => import('@/features/requests/pages/request-desk-page'),
    'RequestDeskPage',
  ),
});
const requestsIndexRoute = createRoute({
  getParentRoute: () => requestsRoute,
  path: '/',
  staticData: { title: 'Requests', permission: ROUTE_PERMISSIONS['/requests'] },
});
const requestDetailRoute = createRoute({
  getParentRoute: () => requestsRoute,
  path: '$requestId',
  staticData: { title: 'Requests', permission: ROUTE_PERMISSIONS['/requests'] },
  component: lazyRouteComponent(
    () => import('@/features/requests/pages/request-desk-page'),
    'RequestDrawerRoute',
  ),
});

// F16: performance dashboard; filters live in the URL so views can be shared (D-104).
const analyticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'analytics',
  staticData: { title: 'Analytics', permission: ROUTE_PERMISSIONS['/analytics'] },
  validateSearch: (s: Record<string, unknown>): Record<string, string | undefined> =>
    Object.fromEntries(
      ['tab', 'range', 'from', 'to', 'fleet', 'vehicle', 'driver']
        .map((k) => [k, optionalString(s[k] === undefined ? undefined : String(s[k]))])
        .filter(([, v]) => v !== undefined),
    ),
  component: lazyRouteComponent(
    () => import('@/features/analytics/pages/analytics-page'),
    'AnalyticsPage',
  ),
});

// Admin pages are a separate chunk each (no map code); F03a / F03b own the page files.
const adminRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: 'admin' });
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  staticData: { title: 'Admin', permission: ROUTE_PERMISSIONS['/admin'] },
  component: lazyRouteComponent(
    () => import('@/features/access/components/admin-overview-page'),
    'AdminOverviewPage',
  ),
});
const adminFleetsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'fleets',
  staticData: { title: 'Fleets', permission: ROUTE_PERMISSIONS['/admin/fleets'] },
  component: lazyRouteComponent(() => import('@/features/access/fleets/fleets-page'), 'FleetsPage'),
});
const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'users',
  staticData: { title: 'Users', permission: ROUTE_PERMISSIONS['/admin/users'] },
  component: lazyRouteComponent(() => import('@/features/access/people/users-page'), 'UsersPage'),
});
const adminDriversRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'drivers',
  staticData: { title: 'Drivers', permission: ROUTE_PERMISSIONS['/admin/drivers'] },
  component: lazyRouteComponent(
    () => import('@/features/drivers/pages/drivers-page'),
    'DriversPage',
  ),
});
const adminInvitesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'invites',
  staticData: { title: 'Invites', permission: ROUTE_PERMISSIONS['/admin/invites'] },
  component: lazyRouteComponent(
    () => import('@/features/access/people/invites-page'),
    'InvitesPage',
  ),
});
const adminRolesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'roles',
  staticData: { title: 'Roles', permission: ROUTE_PERMISSIONS['/admin/roles'] },
  component: lazyRouteComponent(() => import('@/features/access/people/roles-page'), 'RolesPage'),
});
const adminShareLinksRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'share-links',
  staticData: { title: 'Share links', permission: ROUTE_PERMISSIONS['/admin/share-links'] },
  component: lazyRouteComponent(
    () => import('@/features/share/manage/share-links-page'),
    'ShareLinksPage',
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  acceptInviteRoute,
  shareRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    liveTrackingRoute,
    requestsRoute.addChildren([requestsIndexRoute, requestDetailRoute]),
    analyticsRoute,
    adminRoute.addChildren([
      adminIndexRoute,
      adminFleetsRoute,
      adminUsersRoute,
      adminDriversRoute,
      adminInvitesRoute,
      adminRolesRoute,
      adminShareLinksRoute,
    ]),
  ]),
]);

export function createAppRouter(history?: RouterHistory, session: SessionStore = sessionStore) {
  return createRouter({ routeTree, history, context: { session }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface StaticDataRouteOption {
    title?: string;
    /** F03-R1: needed to open the page (any of a list); see `AppLayout`. */
    permission?: PermissionCheck;
  }
}
