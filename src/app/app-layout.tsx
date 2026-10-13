import { useState } from 'react';
import { Link, Outlet, useMatches } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Toaster } from '@/shared/ui/sonner';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';
import { navItems } from './nav-items';
import { PageActionsSlotContext } from './page-actions-context';

const activeOptions = { exact: true } as const;

function Brand() {
  return <span className="font-display text-lg font-bold text-accent">FMS</span>;
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const title = useMatches({ select: (ms) => ms.at(-1)?.staticData.title });

  return (
    <div className="flex h-full">
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r bg-surface-1 py-4 lg:flex">
        <Brand />
        <nav aria-label="Main navigation" className="mt-4 flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={activeOptions}
              title={label}
              aria-label={label}
              className="flex size-10 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-soft data-[status=active]:text-accent"
            >
              <Icon className="size-5" />
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface-1 px-4">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-surface-1">
              <SheetTitle className="px-4 pt-4">
                <Brand />
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
              <nav aria-label="Drawer navigation" className="flex flex-col gap-1 px-2">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    activeOptions={activeOptions}
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-soft data-[status=active]:text-accent"
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-medium tracking-wider text-text-muted uppercase">
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
      <Toaster position="bottom-center" />
    </div>
  );
}
