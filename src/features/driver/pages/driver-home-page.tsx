import { CarFront, ChevronRight, LogOut, Menu, TriangleAlert, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSessionStore } from '@/features/auth/session/use-session';
import { eventsSocket } from '@/features/notifications/events-socket';
import { useNow } from '@/shared/hooks/use-now';
import { BrandMark } from '@/shared/ui/brand-mark';
import { Button } from '@/shared/ui/button';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { IncidentCard } from '../components/incident-card';
import { MyVehicleCard } from '../components/my-vehicle-card';
import { ReportWizard } from '../components/report-wizard';
import { openOfType, orderIncidents } from '../driver-model';
import { DriverStore } from '../driver-store';

function DriverMenu({ name }: { name: string }) {
  const session = useSessionStore();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu">
          <Menu />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-56 rounded-tile border border-glass-border bg-surface-solid p-2 text-text shadow-[0_16px_40px_var(--shadow)]"
        >
          <p className="truncate px-2 py-1.5 text-sm font-semibold">{name}</p>
          <button
            type="button"
            onClick={() => void session.logout()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-text-muted hover:bg-tile hover:text-text"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * `/driver` (F13, D-109): my vehicle, one "Report a problem" flow (the breakdown plus the help
 * needed), and my incidents, each with one live timeline.
 */
export function DriverHomePage({ store: given }: { store?: DriverStore }) {
  const [store] = useState(() => given ?? new DriverStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const now = useNow(15_000) && eventsSocket.now();
  const [reporting, setReporting] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());

  useEffect(() => store.start(), [store]);

  const { me, requests, banner, error } = state;
  const incidents = orderIncidents(requests);
  const hasVehicle = !!me?.vehicle;
  const openBreakdown = openOfType(requests, 'breakdown');
  const openIncident = openBreakdown
    ? incidents.find((i) => i.breakdown?.id === openBreakdown.id)
    : undefined;
  const canAdd = (['rsa', 'replacement'] as const).filter((t) => !openOfType(requests, t));

  const showIncident = (id: string) => {
    setHighlight(id);
    cards.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2500);
  };

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-glass-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[480px] items-center gap-3 px-4">
          <BrandMark />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
              Driver
            </p>
            <p className="truncate text-sm font-semibold" data-testid="driver-greeting">
              {me?.driver.name ?? '…'}
            </p>
          </div>
          <ThemeToggle />
          <DriverMenu name={me?.driver.name ?? ''} />
        </div>
      </header>

      <main className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-4 pb-10">
        {banner && (
          <p
            role="status"
            data-testid="replacement-banner"
            className="flex items-center gap-2 rounded-tile border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm font-semibold text-ok"
          >
            <CarFront className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{banner}</span>
            <button type="button" aria-label="Dismiss" onClick={() => store.dismissBanner()}>
              <X className="size-4" />
            </button>
          </p>
        )}

        {error && !me ? (
          <div className="rounded-tile border border-danger/40 bg-danger/10 p-4 text-sm">
            <p className="mb-3">Couldn’t load your details.</p>
            <Button variant="outline" onClick={() => void store.reload()}>
              Retry
            </Button>
          </div>
        ) : !me ? (
          <div
            className="h-48 animate-pulse rounded-[var(--radius-panel)] bg-tile"
            aria-label="Loading"
          />
        ) : (
          <MyVehicleCard vehicle={me.vehicle} now={now} />
        )}

        {openIncident ? (
          <button
            type="button"
            onClick={() => showIncident(openIncident.id)}
            data-testid="open-incident-cta"
            className="flex h-16 items-center gap-3 rounded-tile border border-warn/50 bg-warn/15 px-4 text-left text-warn"
          >
            <TriangleAlert className="size-6 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">Problem reported</span>
              <span className="block truncate text-xs">See progress or ask for more help</span>
            </span>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            disabled={!me || !hasVehicle}
            onClick={() => setReporting(true)}
            className="flex h-16 items-center gap-3 rounded-tile border border-danger/50 bg-danger/15 px-4 text-left text-danger transition-colors hover:bg-danger/25 disabled:pointer-events-none disabled:opacity-40"
          >
            <TriangleAlert className="size-6 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">Report a problem</span>
              <span className="block truncate text-xs opacity-80">
                Breakdown, roadside help or another vehicle
              </span>
            </span>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        )}

        <section aria-label="My incidents" className="flex flex-col gap-2.5">
          <h2 className="mt-2 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            My incidents
          </h2>
          {me && !incidents.length && <p className="text-sm text-text-muted">No incidents yet.</p>}
          {incidents.map((i) => (
            <IncidentCard
              key={i.id}
              incident={i}
              now={now}
              highlight={highlight === i.id}
              canAdd={canAdd}
              onAdd={async (type) => {
                await store.submit({ type, note: 'Added to my earlier report' });
              }}
              ref={(el) => {
                if (el) cards.current.set(i.id, el);
                else cards.current.delete(i.id);
              }}
            />
          ))}
          {incidents.some((i) => !i.open) && (
            <p className="text-center text-[11px] text-text-faint">Showing the last 10 closed.</p>
          )}
        </section>
      </main>

      <ReportWizard
        open={reporting}
        onOpenChange={setReporting}
        onSubmit={(body) => store.submit(body)}
      />
    </div>
  );
}
