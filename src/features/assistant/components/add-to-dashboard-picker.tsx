import { useState } from 'react';
import { LayoutDashboard, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { toast } from 'sonner';
import {
  WIDGETS_PER_DASHBOARD,
  type DashboardSummary,
  type WidgetPreview,
} from '@shared/contract/dashboards.ts';
import {
  addWidgetToDashboard,
  dashboardsApi,
  type DashboardsApi,
} from '@/features/dashboards/api/dashboards-api';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { dashboardEvents } from '../dashboard-events.ts';

const item =
  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-tile data-[highlighted]:text-accent [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * D-135 (global Ask FMS panel): "Add to dashboard…" → the user's own dashboards plus
 * "New dashboard". Calls `onAdded` with the dashboard the widget landed on.
 */
export function AddToDashboardPicker({
  preview,
  onAdded,
  api = dashboardsApi,
}: {
  preview: WidgetPreview;
  onAdded(dashboard: { id: string; title: string }): void;
  api?: Pick<DashboardsApi, 'list' | 'get' | 'patch' | 'create'>;
}) {
  const [mine, setMine] = useState<DashboardSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setFailed(false);
    try {
      const list = await api.list();
      setMine(list.mine);
    } catch {
      setFailed(true);
    }
  };

  const add = async (id: string | null) => {
    setBusy(true);
    try {
      const target = id ?? (await api.create()).id;
      if (!id) dashboardEvents.emit({ kind: 'created', dashboardId: target });
      const d = await addWidgetToDashboard(api, target, preview.widget);
      dashboardEvents.emit({ kind: 'changed', dashboardId: d.id });
      toast(`Added to '${d.title}'`);
      onAdded({ id: d.id, title: d.title });
    } catch (err) {
      toast.error(
        err instanceof ApiError &&
          (err.code === 'dashboard_limit' || err.code === 'widget_not_permitted')
          ? err.message
          : "Couldn't add the widget.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button size="xs" disabled={busy} data-testid="preview-add-picker">
          <Plus aria-hidden />
          {busy ? 'Adding…' : 'Add to dashboard…'}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          data-testid="dashboard-picker"
          className="z-[60] max-h-72 w-60 overflow-y-auto rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-float"
        >
          {mine === null && !failed && (
            <p className="px-2.5 py-2 text-xs text-text-muted">Loading dashboards…</p>
          )}
          {failed && (
            <p role="alert" className="px-2.5 py-2 text-xs text-danger">
              Couldn't load your dashboards.
            </p>
          )}
          {mine?.map((d) => {
            const full = d.widgetCount >= WIDGETS_PER_DASHBOARD;
            return (
              <DropdownMenu.Item
                key={d.id}
                className={item}
                disabled={full}
                onSelect={() => void add(d.id)}
                data-testid="picker-dashboard"
              >
                <LayoutDashboard aria-hidden className="text-text-faint" />
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                {full && <span className="text-[11px] text-text-faint">Full</span>}
              </DropdownMenu.Item>
            );
          })}
          {mine && mine.length > 0 && (
            <DropdownMenu.Separator className="my-1 h-px bg-glass-border" />
          )}
          {mine && (
            <DropdownMenu.Item
              className={item}
              onSelect={() => void add(null)}
              data-testid="picker-new"
            >
              <Plus aria-hidden className="text-accent" />
              New dashboard
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
