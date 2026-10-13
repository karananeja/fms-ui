import { useState } from 'react';
import { Link, Outlet, useMatches } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';
import { navItems } from './nav-items';
import { PageActionsSlotContext } from './page-actions-context';

const activeOptions = { exact: true } as const;

function Brand() {
  return (
    <span
      aria-label="FMS"
      className="grid size-[38px] place-items-center rounded-tile bg-linear-135 from-accent to-accent-2 text-[15px] font-black text-accent-ink shadow-[0_0_24px_var(--accent-glow)]"
    >
      F
    </span>
  );
}

const navLink =
  'text-text-faint outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:bg-accent-soft data-[status=active]:text-accent data-[status=active]:shadow-[inset_2px_0_0_var(--accent)]';

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const title = useMatches({ select: (ms) => ms.at(-1)?.staticData.title });

  return (
    <div className="flex h-full">
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-glass-border bg-surface-solid py-4 lg:flex">
        <Brand />
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-glass-border bg-surface-solid px-4">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-glass-border bg-surface-solid">
              <SheetTitle className="flex items-center gap-3 px-4 pt-4 text-sm font-black tracking-[0.12em]">
                <Brand />
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
            </SheetContent>
          </Sheet>
          <span className="truncate text-xs font-extrabold tracking-[0.12em] text-text-muted uppercase">
            {title}
          </span>
          <div
            ref={setActionsSlot}
            data-slot="page-actions"
            className="ml-auto flex items-center gap-2"
          />
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <PageActionsSlotContext value={actionsSlot}>
            <Outlet />
          </PageActionsSlotContext>
        </main>
      </div>
    </div>
  );
}
