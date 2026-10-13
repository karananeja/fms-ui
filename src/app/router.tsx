import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { PlaceholderPage } from '@/shared/ui/placeholder-page';
import { AppLayout } from './app-layout';
import { NotFoundPage } from './not-found-page';

const rootRoute = createRootRoute({
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

// Auth and public routes render without the app shell.
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  staticData: { title: 'Sign in' },
  component: PlaceholderPage,
});
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'forgot-password',
  staticData: { title: 'Forgot password' },
  component: PlaceholderPage,
});
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reset-password',
  staticData: { title: 'Reset password' },
  component: PlaceholderPage,
});
const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accept-invite',
  staticData: { title: 'Accept invite' },
  component: PlaceholderPage,
});
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'share/$token',
  staticData: { title: 'Shared live location' },
  component: PlaceholderPage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppLayout,
});

const liveTrackingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'live-tracking',
  staticData: { title: 'Live tracking' },
  component: PlaceholderPage,
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

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface StaticDataRouteOption {
    title?: string;
  }
}
