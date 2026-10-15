import { Link } from '@tanstack/react-router';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import type { DashboardLink } from '@shared/contract/assistant.ts';

const widgetsText = (n: number) => `${n} ${n === 1 ? 'widget' : 'widgets'}`;

/** F19 §7: a dashboard the assistant created, with "Open dashboard" → `/dashboards/$id`. */
export function DashboardLinkCard({
  link,
  onNavigate,
}: {
  link: DashboardLink;
  onNavigate?(): void;
}) {
  const { summary } = link;
  return (
    <div
      data-testid="dashboard-link-card"
      className="flex items-center gap-3 rounded-tile border border-tile-border bg-tile p-3"
    >
      <LayoutDashboard className="size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-text" title={summary.title}>
          {summary.title}
        </p>
        <p className="mt-0.5 text-[11px] text-text-muted">{widgetsText(summary.widgetCount)}</p>
      </div>
      <Link
        // The page route is F20's; the server sends the resolved path (`/dashboards/<id>`).
        to={link.url as never}
        onClick={onNavigate}
        data-testid="dashboard-link"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-tile-border bg-tile px-3 text-xs font-bold outline-none hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open dashboard
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
