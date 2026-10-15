import { Component, type ReactNode } from 'react';
import { AlertTriangle, Lock, MapPinOff, RotateCcw, SearchX } from 'lucide-react';
import type { WidgetType } from '@shared/contract/dashboards.ts';
import { ApiError } from '@/shared/api/api-client';
import { cn } from '@/shared/lib/utils';

/** §6.1 copy, the same in every renderer. */
export const STATE_COPY = {
  error: "Couldn't load this widget",
  notFound: 'Vehicle, driver or fleet not found',
  noAccess: "You don't have access to this data",
  outside: 'Outside your fleets',
  emptyPeriod: 'No data for this period',
  noVehicles: 'No vehicles match',
} as const;

export type WidgetIssue = 'error' | 'not-found' | 'no-access' | 'outside';

/** API error → widget state (403 = outside the viewer's fleets, 404 = not found). */
export function issueOf(err: unknown): WidgetIssue {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'outside';
    if (err.status === 404) return 'not-found';
  }
  return 'error';
}

const ICON: Record<WidgetIssue, typeof Lock> = {
  error: AlertTriangle,
  'not-found': SearchX,
  'no-access': Lock,
  outside: MapPinOff,
};
const TEXT: Record<WidgetIssue, string> = {
  error: STATE_COPY.error,
  'not-found': STATE_COPY.notFound,
  'no-access': STATE_COPY.noAccess,
  outside: STATE_COPY.outside,
};

export function WidgetIssueState({ issue, onRetry }: { issue: WidgetIssue; onRetry?: () => void }) {
  const Icon = ICON[issue];
  return (
    <div
      data-testid="widget-state"
      data-state={issue}
      className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-text-muted"
    >
      <Icon
        aria-hidden
        className={cn('size-5', issue === 'error' ? 'text-danger' : 'text-text-faint')}
      />
      <p>{TEXT[issue]}</p>
      {issue === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="widget-no-drag inline-flex h-8 items-center gap-1.5 rounded-md border border-tile-border bg-tile px-3 text-xs font-semibold text-text outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

export function WidgetEmpty({ text = STATE_COPY.emptyPeriod }: { text?: string }) {
  return (
    <p
      data-testid="widget-state"
      data-state="empty"
      className="grid h-full place-items-center p-3 text-center text-xs text-text-muted"
    >
      {text}
    </p>
  );
}

/** Loading skeleton shaped per widget type. */
export function WidgetSkeleton({ type }: { type: WidgetType }) {
  const bar = 'animate-pulse rounded-md bg-tile motion-reduce:animate-none';
  return (
    <div
      data-testid="widget-state"
      data-state="loading"
      aria-busy
      className="flex h-full flex-col gap-2 p-1"
    >
      <span className="sr-only">Loading</span>
      {type === 'kpi' ? (
        <>
          <span className={cn(bar, 'h-8 w-24')} />
          <span className={cn(bar, 'h-3 w-16')} />
        </>
      ) : type === 'daily-chart' || type === 'status-breakdown' ? (
        <span className={cn(bar, 'min-h-0 flex-1')} />
      ) : (
        Array.from({ length: 4 }, (_, k) => <span key={k} className={cn(bar, 'h-5')} />)
      )}
    </div>
  );
}

/** Thin bar shown over the previous data while a refresh is in flight. */
export function RefreshBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      data-testid="widget-refreshing"
      className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-accent motion-reduce:animate-none"
    />
  );
}

/** §6.1: a renderer bug shows the error state for that widget only. */
export class WidgetErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean; key: string }
> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; key: string },
  ) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  componentDidCatch(error: unknown) {
    console.warn('[dashboards] widget failed to render', error);
  }

  render() {
    return this.state.failed ? <WidgetIssueState issue="error" /> : this.props.children;
  }
}
