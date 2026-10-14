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
    adminRoute.addChildren([
      adminIndexRoute,
      adminFleetsRoute,
      adminUsersRoute,
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
