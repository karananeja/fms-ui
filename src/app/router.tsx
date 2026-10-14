import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { AcceptInvitePage } from '@/features/auth/components/accept-invite-page';
import { ForgotPasswordPage } from '@/features/auth/components/forgot-password-page';
import { LoginPage } from '@/features/auth/components/login-page';
import { ResetPasswordPage } from '@/features/auth/components/reset-password-page';
import { sessionStore, type SessionStore } from '@/features/auth/session/session-store';
import { LiveTrackingPage } from '@/features/live-tracking/components/live-tracking-page';
import { parseLiveTrackingSearch } from '@/features/live-tracking/hooks/use-selection-url-sync';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';
import { AppLayout } from './app-layout';
import { NotFoundPage } from './not-found-page';

export interface RouterContext {
  session: SessionStore;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/live-tracking' });
  },
});

const optionalString = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/** F02-R2: `/login` and `/forgot-password` are for signed-out users only. */
async function signedOutOnly({ context }: { context: RouterContext }) {
  await context.session.load();
  if (context.session.getSnapshot().status === 'authenticated') {
    throw redirect({ to: '/live-tracking', replace: true });
  }
}

// Auth and public routes render without the app shell.
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  staticData: { title: 'Sign in' },
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => {
    const redirect = optionalString(s.redirect);
    return redirect ? { redirect } : {};
  },
  beforeLoad: signedOutOnly,
  component: LoginPage,
});
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'forgot-password',
  staticData: { title: 'Forgot password' },
  beforeLoad: signedOutOnly,
  component: ForgotPasswordPage,
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
  component: ResetPasswordPage,
});
const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accept-invite',
  staticData: { title: 'Accept invite' },
  validateSearch: tokenSearch,
  component: AcceptInvitePage,
});
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'share/$token',
  staticData: { title: 'Shared live location' },
  component: PlaceholderPage,
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

const liveTrackingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'live-tracking',
  staticData: { title: 'Live tracking' },
  validateSearch: parseLiveTrackingSearch,
  component: LiveTrackingPage,
});

const adminRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: 'admin' });
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  staticData: { title: 'Admin' },
  component: PlaceholderPage,
});
const adminFleetsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'fleets',
  staticData: { title: 'Fleets' },
  component: PlaceholderPage,
});
const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'users',
  staticData: { title: 'Users' },
  component: PlaceholderPage,
});
const adminInvitesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'invites',
  staticData: { title: 'Invites' },
  component: PlaceholderPage,
});
const adminRolesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'roles',
  staticData: { title: 'Roles' },
  component: PlaceholderPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  acceptInviteRoute,
  shareRoute,
  appLayoutRoute.addChildren([
    liveTrackingRoute,
    adminRoute.addChildren([
      adminIndexRoute,
      adminFleetsRoute,
      adminUsersRoute,
      adminInvitesRoute,
      adminRolesRoute,
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
  }
}
