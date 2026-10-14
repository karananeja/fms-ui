import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useMatches, useRouter } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { RequirePermission } from '@/features/access/permissions/require-permission';
import { UserMenu } from '@/features/auth/components/user-menu';
import { NotificationBell } from '@/features/notifications/components/notification-bell';
import {
  selectMe,
  selectStatus,
  useSession,
  useSessionStore,
} from '@/features/auth/session/use-session';
import { BrandMark } from '@/shared/ui/brand-mark';
import { Button } from '@/shared/ui/button';
import { Toaster } from '@/shared/ui/sonner';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';
import { visibleNavItems } from './nav-items';
import { PageActionsSlotContext } from './page-actions-context';

const activeOptions = { exact: true } as const;

const navLink =
  'text-text-faint outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-accent-soft data-[status=active]:text-accent data-[status=active]:shadow-[inset_2px_0_0_var(--accent)]';

/**
 * F02-R3/R11: when the session ends while the shell is shown (sign-out, any 401, WS
 * `unauthenticated`), go to `/login`; an expiry keeps the current page as `?redirect=`.
 */
function useLeaveWhenSignedOut(): boolean {
  const session = useSessionStore();
  const status = useSession(selectStatus);
  const router = useRouter();
  const signedOut = status !== 'authenticated';
  useEffect(() => {
    if (!signedOut) return;
    const expired = session.getSnapshot().notice === 'expired';
    const redirect = router.state.location.href;
    void router.navigate({ to: '/login', search: expired ? { redirect } : {}, replace: expired });
  }, [signedOut, session, router]);
  return signedOut;
}

export function AppLayout() {
  const signedOut = useLeaveWhenSignedOut();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  // The leaf route's static options (a stable reference).
  const { title, permission } = useMatches({ select: (ms) => ms.at(-1)?.staticData }) ?? {};
  const me = useSession(selectMe);
  // F03-R2: only the pages you can open.
  const navItems = useMemo(() => visibleNavItems(me), [me]);
  // No shell (and no live data) once signed out, not even for the frame before navigating.
  if (signedOut) return null;

  return (
    <div className="flex h-full">
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-glass-border bg-surface-solid py-4 lg:flex">
        <BrandMark />
        <nav aria-label="Main navigation" className="mt-3.5 flex flex-col gap-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={activeOptions}
              title={label}
              aria-label={label}
              className={`flex size-11 items-center justify-center rounded-tile ${navLink}`}
            >
              <Icon className="size-5" />
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <UserMenu variant="rail" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-glass-border bg-surface-solid px-4">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-3 border-glass-border bg-surface-solid">
              <SheetTitle className="flex items-center gap-3 px-4 pt-4 text-sm font-black tracking-[0.12em]">
                <BrandMark />
                FMS
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
              <nav aria-label="Drawer navigation" className="flex flex-col gap-1 px-2">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    activeOptions={activeOptions}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 rounded-tile px-3 py-2.5 text-sm ${navLink}`}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto pb-4">
                <UserMenu variant="drawer" />
              </div>
            </SheetContent>
          </Sheet>
          <span className="truncate text-xs font-extrabold tracking-[0.12em] text-text-muted uppercase">
            {title}
          </span>
          {/* F15-R1: the bell, before the page's own actions. */}
          <NotificationBell className="ml-auto" />
          <div ref={setActionsSlot} data-slot="page-actions" className="flex items-center gap-2" />
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <PageActionsSlotContext value={actionsSlot}>
            {/* F03-R1: the page's `staticData.permission`, else No access. */}
            {permission ? (
              <RequirePermission p={permission}>
                <Outlet />
              </RequirePermission>
            ) : (
              <Outlet />
            )}
          </PageActionsSlotContext>
        </main>
      </div>
      <Toaster position="bottom-center" />
    </div>
  );
}
