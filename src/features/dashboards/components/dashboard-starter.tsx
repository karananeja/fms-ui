import { useMemo, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Gauge,
  HeartPulse,
  KeyRound,
  LifeBuoy,
  MousePointerClick,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { Permission } from '@shared/contract/permissions.ts';
import { can } from '@/features/access/permissions/can';
import type { TurnFailure } from '@/features/assistant/chat-progress';
import { Composer } from '@/features/assistant/components/composer';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { Button } from '@/shared/ui/button';

interface Chip {
  text: string;
  needs: readonly Permission[];
}
interface Group {
  id: string;
  title: string;
  icon: LucideIcon;
  chips: readonly Chip[];
}
interface Template {
  id: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  prompt: string;
  needs: readonly Permission[];
}

const STARTER_GROUPS: readonly Group[] = [
  {
    id: 'live',
    title: 'Live ops',
    icon: Activity,
    chips: [
      { text: 'Show running, idle and stopped vehicles by status', needs: ['live.view'] },
      { text: 'Add a KPI of running vehicles', needs: ['live.view'] },
      { text: 'List vehicles with no GPS right now', needs: ['live.view'] },
    ],
  },
  {
    id: 'performance',
    title: 'Performance',
    icon: Gauge,
    chips: [
      { text: 'Top 10 vehicles by idle time this week', needs: ['analytics.view'] },
      { text: 'Daily distance driven over the last 30 days', needs: ['analytics.view'] },
    ],
  },
  {
    id: 'drivers',
    title: 'Drivers',
    icon: Users,
    chips: [
      { text: 'Rank the top drivers by score this week', needs: ['analytics.view'] },
      { text: 'List drivers on duty', needs: ['drivers.manage'] },
    ],
  },
  {
    id: 'requests-ev',
    title: 'Requests & EV',
    icon: Wrench,
    chips: [
      { text: 'Show open breakdown requests', needs: ['requests.manage'] },
      { text: 'List vehicles with battery below 20%', needs: ['live.view'] },
    ],
  },
];

const STARTER_TEMPLATES: readonly Template[] = [
  {
    id: 'fleet-health',
    title: 'Fleet health',
    blurb: 'Running vs stopped, no-GPS vehicles, daily distance',
    icon: HeartPulse,
    prompt:
      'Build a fleet health dashboard: a KPI of running vehicles, vehicles by status, vehicles with no GPS and daily distance for the last 7 days',
    needs: ['live.view', 'analytics.view'],
  },
  {
    id: 'driver-performance',
    title: 'Driver performance',
    blurb: 'Top drivers by score and distance this week',
    icon: Trophy,
    prompt:
      'Build a driver performance dashboard: top 10 drivers by score this week and top drivers by distance',
    needs: ['analytics.view'],
  },
  {
    id: 'ev-battery',
    title: 'EV battery watch',
    blurb: 'Charging now, low battery list, energy trend',
    icon: BatteryCharging,
    prompt:
      'Build an EV battery dashboard: a KPI of charging vehicles, vehicles with battery below 20% and daily energy used over 30 days',
    needs: ['live.view'],
  },
  {
    id: 'breakdowns',
    title: 'Breakdowns this week',
    blurb: 'Open breakdown requests and requests by type',
    icon: LifeBuoy,
    prompt:
      'Build a breakdowns dashboard: open breakdown requests and a summary of requests by type this week',
    needs: ['requests.manage'],
  },
];

const STEPS = [
  { icon: Sparkles, text: 'Ask FMS to add widgets' },
  { icon: Activity, text: 'Check the live preview' },
  { icon: MousePointerClick, text: 'Add it or drag it onto the grid' },
];

/** Background ghost tiles (12-column sketch). */
function GhostGrid() {
  const tiles = [
    'col-span-3 row-span-2',
    'col-span-3 row-span-2',
    'col-span-6 row-span-3',
    'col-span-6 row-span-3',
    'col-span-6 row-span-2',
  ];
  return (
    <div
      aria-hidden
      data-testid="starter-ghost"
      className="pointer-events-none absolute inset-0 grid grid-cols-12 grid-rows-6 gap-3 [mask-image:linear-gradient(to_bottom,black,transparent)] p-1 opacity-60"
    >
      {tiles.map((c, k) => (
        <div
          key={k}
          className={`${c} animate-pulse rounded-tile border border-dashed border-tile-border bg-tile motion-reduce:animate-none`}
        />
      ))}
    </div>
  );
}

/**
 * F23: what an empty dashboard opens with (owners with chat): a "What do you want to see?" hero
 * with a focused prompt box, example chips grouped by theme, one-click starter templates and a
 * how-it-works line, over ghost tiles. Only what the user's permissions can show is offered.
 */
export function DashboardStarter({
  streaming,
  onSend,
  onStop,
  compact = false,
  notice,
}: {
  streaming: boolean;
  onSend(prompt: string): void;
  onStop(): void;
  /** The dock is open (it has the prompt box): templates and chips only, under `notice`. */
  compact?: boolean;
  /** Shown above the templates in compact mode (e.g. the last turn's failure card). */
  notice?: ReactNode;
}) {
  const me = useSession(selectMe);
  const allowed = useMemo(
    () => (needs: readonly Permission[]) => needs.every((p) => can(me, p)),
    [me],
  );
  const groups = STARTER_GROUPS.map((g) => ({
    ...g,
    chips: g.chips.filter((c) => allowed(c.needs)),
  })).filter((g) => g.chips.length > 0);
  const templates = STARTER_TEMPLATES.filter((t) => allowed(t.needs));

  return (
    <div
      data-testid="dashboard-starter"
      data-compact={compact || undefined}
      className="relative min-h-[28rem] w-full"
    >
      <GhostGrid />
      <div className="relative mx-auto flex max-w-3xl flex-col gap-5 py-6 text-left">
        {compact ? (
          notice
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid shadow-float">
            <div className="px-5 pt-5">
              <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-wide">
                <Sparkles aria-hidden className="size-5 text-accent" />
                What do you want to see?
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                Describe it in plain words, or start from an example below.
              </p>
            </div>
            <Composer
              streaming={streaming}
              onSend={onSend}
              onStop={onStop}
              placeholder="e.g. Running vs stopped vehicles and today's open breakdowns"
              suggestions="dashboard"
            />
          </div>
        )}

        {templates.length > 0 && (
          <section aria-labelledby="starter-templates">
            <h3
              id="starter-templates"
              className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-text-faint uppercase"
            >
              Start from a template
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={streaming}
                    data-testid="starter-template"
                    data-template={t.id}
                    onClick={() => onSend(t.prompt)}
                    className="group flex w-full items-center gap-3 rounded-tile border border-tile-border bg-surface-solid p-3 text-left outline-none hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent">
                      <t.icon aria-hidden className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold group-hover:text-accent">
                        {t.title}
                      </span>
                      <span className="block truncate text-xs text-text-muted">{t.blurb}</span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 text-text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length > 0 && (
          <section aria-label="Example prompts" className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.id} data-testid="starter-group" data-group={g.id}>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  <g.icon aria-hidden className="size-3.5" />
                  {g.title}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {g.chips.map((c) => (
                    <button
                      key={c.text}
                      type="button"
                      disabled={streaming}
                      data-testid="starter-chip"
                      onClick={() => onSend(c.text)}
                      className="min-h-7 rounded-full border border-tile-border bg-surface-solid px-3 py-1 text-left text-xs text-text-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {c.text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <ol
          aria-label="How it works"
          data-testid="starter-how"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted"
        >
          {STEPS.map((s, i) => (
            <li key={s.text} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight aria-hidden className="size-3 text-text-faint" />}
              <s.icon aria-hidden className="size-3.5 text-accent" />
              {s.text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The empty canvas's card for a failed (or cut-off) last turn: the reason, Retry, settings. */
export function TurnFailureCard({
  failure,
  onRetry,
}: {
  failure: TurnFailure;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="canvas-failure"
      className="rounded-[var(--radius-panel)] border border-danger/30 bg-surface-solid p-5 shadow-float"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert aria-hidden className="size-5 text-danger" />
        Couldn't build your dashboard
      </h2>
      <p className="mt-1 text-sm text-text-muted">{failure.message}</p>
      {(failure.retryable || failure.setup) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {failure.retryable && onRetry && (
            <Button size="sm" onClick={onRetry} data-testid="canvas-retry">
              <RotateCcw aria-hidden />
              Retry
            </Button>
          )}
          {failure.setup && (
            <Button asChild size="sm" variant="outline">
              <Link to="/settings/ai" data-testid="canvas-settings">
                <KeyRound aria-hidden />
                AI settings
              </Link>
            </Button>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-text-faint">Or start again from a template below.</p>
    </div>
  );
}
