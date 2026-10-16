import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Building2,
  History,
  IdCard,
  KeyRound,
  Link2,
  MailPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { listAudit } from '@/features/activity/api/activity-api';
import { listDrivers } from '@/features/drivers/api/drivers-api';
import { listShareLinks } from '@/features/share/api/share-api';
import { countActive } from '@/features/share/lib/share-link-model';
import { listFleets, listInvites, listRoles, listUsers } from '../api/access-api';
import { useResource } from '../lib/use-resource';
import { useCan } from '../permissions/can';
import { AdminLayout } from './admin-layout';

const count = new Intl.NumberFormat('en-IN');

function OverviewCard({
  to,
  icon: Icon,
  label,
  load,
}: {
  to:
    | '/admin/fleets'
    | '/admin/users'
    | '/admin/drivers'
    | '/admin/invites'
    | '/admin/roles'
    | '/admin/share-links'
    | '/admin/activity';
  icon: LucideIcon;
  label: string;
  load: (signal: AbortSignal) => Promise<ReactNode>;
}) {
  const res = useResource(load);
  return (
    <Link
      to={to}
      aria-label={label}
      data-testid={`overview-${to.split('/').at(-1)}`}
      className="group flex min-h-36 flex-col justify-between gap-4 rounded-[var(--radius-panel)] p-5 shadow-panel glass outline-none hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-tile bg-accent-soft text-accent">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="text-xs font-semibold tracking-[0.06em] text-text-muted uppercase">
          {label}
        </span>
        <ArrowRight
          aria-hidden
          className="ml-auto size-4 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
        />
      </div>
      <div className="min-h-10 text-sm text-text-muted">
        {res.error ? "Couldn't load" : res.data === undefined ? 'Loading…' : res.data}
      </div>
    </Link>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <span className="font-display text-4xl font-black text-text tabular-nums">{children}</span>
);

/** `/admin` (F03-R11): one card per admin page you can open, with its count. */
export function AdminOverviewPage() {
  const fleets = useCan('fleets.manage');
  const users = useCan('users.manage');
  const invites = useCan('users.invite');
  const roles = useCan('roles.manage');
  const shares = useCan('share.revoke');
  const drivers = useCan('drivers.manage');
  const activity = useCan('audit.view');
  return (
    <AdminLayout
      title="Admin"
      description="Fleets, users, drivers, invites, roles and share links."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {fleets && (
          <OverviewCard
            to="/admin/fleets"
            icon={Building2}
            label="Fleets"
            load={async (signal) => {
              const list = await listFleets({ signal });
              return (
                <>
                  <Big>{count.format(list.length)}</Big> fleets
                </>
              );
            }}
          />
        )}
        {users && (
          <OverviewCard
            to="/admin/users"
            icon={Users}
            label="Users"
            load={async (signal) => {
              const list = await listUsers({ signal });
              const active = list.filter((u) => u.status === 'active').length;
              return (
                <>
                  <Big>{count.format(active)}</Big> active ·{' '}
                  <span className="tabular-nums">{count.format(list.length - active)}</span>{' '}
                  disabled
                </>
              );
            }}
          />
        )}
        {drivers && (
          <OverviewCard
            to="/admin/drivers"
            icon={IdCard}
            label="Drivers"
            load={async (signal) => {
              // F12-R1: no count endpoint in F11, so one max page; "500+" past that.
              const page = await listDrivers({ status: 'active', limit: 500 }, { signal });
              return (
                <>
                  <Big>
                    {count.format(page.items.length)}
                    {page.nextCursor ? '+' : ''}
                  </Big>{' '}
                  active
                </>
              );
            }}
          />
        )}
        {invites && (
          <OverviewCard
            to="/admin/invites"
            icon={MailPlus}
            label="Pending invites"
            load={async (signal) => {
              const list = await listInvites({ signal });
              return (
                <>
                  <Big>{count.format(list.filter((i) => i.status === 'pending').length)}</Big>{' '}
                  pending
                </>
              );
            }}
          />
        )}
        {roles && (
          <OverviewCard
            to="/admin/roles"
            icon={KeyRound}
            label="Roles"
            load={async (signal) => {
              const list = await listRoles({ signal });
              return (
                <>
                  <Big>{count.format(list.length)}</Big> roles
                </>
              );
            }}
          />
        )}
        {shares && (
          <OverviewCard
            to="/admin/share-links"
            icon={Link2}
            label="Share links"
            load={async (signal) => {
              const list = await listShareLinks({}, { signal });
              return (
                <>
                  <Big>{count.format(countActive(list))}</Big> active
                </>
              );
            }}
          />
        )}
        {activity && (
          <OverviewCard
            to="/admin/activity"
            icon={History}
            label="Activity"
            load={async (signal) => {
              const page = await listAudit({}, { signal });
              return (
                <>
                  <Big>
                    {count.format(page.items.length)}
                    {page.nextCursor ? '+' : ''}
                  </Big>{' '}
                  recent
                </>
              );
            }}
          />
        )}
      </div>
    </AdminLayout>
  );
}
