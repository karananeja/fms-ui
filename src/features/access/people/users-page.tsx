import type { Fleet, Role, User } from '@shared/contract/index.ts';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { inputClass } from '@/features/auth/components/text-field';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { listFleets, listRoles, listUsers, updateUser } from '../api/access-api';
import { AdminLayout } from '../components/admin-layout';
import {
  AdminStatusPill,
  ConfirmDialog,
  DataTable,
  LoadError,
  LockedNote,
  Segmented,
  SelectField,
  FilterSelect,
  SidePanel,
  type Column,
} from '../components/admin-ui';
import { FleetPicker } from '../fleets/fleet-picker';
import { byId, errorText, fleetScopeLabel, roleName } from '../lib/access-format';
import { useResource } from '../lib/use-resource';
import { useCan } from '../permissions/can';

type StatusFilter = 'all' | User['status'];

const OWN_ROLE_REASON = "You can't change your own role.";
const OWN_STATUS_REASON = "You can't change your own status.";
const NO_ROLES_REASON = 'Changing roles needs the Manage roles permission.';

/** `/admin/users` (F03-R8): table, search, role / status filters, side panel to edit a user. */
export function UsersPage() {
  const me = useSession(selectMe);
  const canListRoles = useCan('roles.manage');
  const res = useResource(async (signal) => {
    const [users, fleets, roles] = await Promise.all([
      listUsers({ signal }),
      listFleets({ signal }),
      canListRoles ? listRoles({ signal }) : Promise.resolve<Role[]>([]),
    ]);
    return { users, fleets, roles };
  }, String(canListRoles));
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const users = useMemo(() => res.data?.users ?? [], [res.data]);
  const fleetsById = useMemo(() => byId(res.data?.fleets), [res.data]);
  const rolesById = useMemo(() => byId(res.data?.roles), [res.data]);
  const roleOptions = useMemo(() => {
    const ids = new Set([...rolesById.keys(), ...users.map((u) => u.roleId)]);
    return [...ids]
      .map((id) => ({ value: id, label: roleName(id, rolesById) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rolesById, users]);

  const needle = q.trim().toLowerCase();
  const rows = users.filter(
    (u) =>
      (!needle ||
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle)) &&
      (roleFilter === 'all' || u.roleId === roleFilter) &&
      (status === 'all' || u.status === status),
  );
  const selected = users.find((u) => u.id === openId) ?? null;

  const columns: Column<User>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (u) => (
        <div className="min-w-0">
          <span className="font-extrabold">{u.name}</span>
          {u.id === me?.user.id && (
            <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-black tracking-[0.08em] text-accent uppercase">
              You
            </span>
          )}
          <div className="max-w-[42vw] truncate text-xs text-text-muted md:hidden">{u.email}</div>
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      className: 'hidden md:table-cell',
      cell: (u) => <span className="text-text-muted">{u.email}</span>,
    },
    { id: 'role', header: 'Role', cell: (u) => roleName(u.roleId, rolesById) },
    {
      id: 'fleets',
      header: 'Fleet scope',
      className: 'hidden sm:table-cell',
      cell: (u) => (
        <span className="text-text-muted">{fleetScopeLabel(u.fleetIds, fleetsById)}</span>
      ),
    },
    { id: 'status', header: 'Status', cell: (u) => <AdminStatusPill status={u.status} /> },
  ];

  return (
    <AdminLayout title="Users" description="People who can sign in, their role and fleet scope.">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-faint"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search users"
            className={cn(inputClass, 'h-10 pl-9')}
          />
        </label>
        <FilterSelect
          label="Filter by role"
          value={roleFilter}
          onChange={setRoleFilter}
          options={[{ value: 'all', label: 'All roles' }, ...roleOptions]}
        />
        <Segmented<StatusFilter>
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <span className="ml-auto text-xs text-text-muted tabular-nums" aria-live="polite">
          {rows.length} of {users.length} users
        </span>
      </div>
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      <DataTable
        label="Users"
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        onRowClick={(u) => setOpenId(u.id)}
        selectedKey={openId}
        loading={res.loading}
        empty={users.length ? 'No users match these filters.' : 'No users yet.'}
      />
      <SidePanel
        open={selected !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        title={selected?.name ?? ''}
        description={selected?.email}
      >
        {selected && me && (
          <UserPanel
            key={selected.id}
            user={selected}
            isSelf={selected.id === me.user.id}
            roleOptions={roleOptions}
            canChangeRoles={canListRoles}
            fleets={res.data?.fleets ?? []}
            onSaved={(updated) =>
              res.setData(
                (d) =>
                  d && { ...d, users: d.users.map((u) => (u.id === updated.id ? updated : u)) },
              )
            }
            onClose={() => setOpenId(null)}
          />
        )}
      </SidePanel>
    </AdminLayout>
  );
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** F03-R8 panel body: role, fleet scope, status; own role / status locked with the reason. */
function UserPanel({
  user,
  isSelf,
  roleOptions,
  canChangeRoles,
  fleets,
  onSaved,
  onClose,
}: {
  user: User;
  isSelf: boolean;
  roleOptions: readonly { value: string; label: string }[];
  canChangeRoles: boolean;
  fleets: readonly Fleet[];
  onSaved: (user: User) => void;
  onClose: () => void;
}) {
  const [roleId, setRoleId] = useState(user.roleId);
  const [fleetIds, setFleetIds] = useState<string[]>(user.fleetIds);
  const [status, setStatus] = useState(user.status);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);

  const patch = {
    ...(roleId !== user.roleId && { roleId }),
    ...(!sameIds(fleetIds, user.fleetIds) && { fleetIds }),
    ...(status !== user.status && { status }),
  };
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateUser(user.id, patch);
      onSaved(updated);
      toast.success(`Saved ${updated.name}`);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
      setConfirming(false);
    }
  };
  const submit = () => {
    if (fleetIds.length === 0) {
      setFleetError('Choose at least one fleet.');
      return;
    }
    if (patch.status === 'disabled') setConfirming(true);
    else void save();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SelectField
        id="user-role"
        label="Role"
        value={roleId}
        onChange={setRoleId}
        options={roleOptions}
        disabled={isSelf || !canChangeRoles}
        hint={isSelf ? OWN_ROLE_REASON : !canChangeRoles ? NO_ROLES_REASON : undefined}
      />
      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-bold text-text-muted">Fleet scope</span>
        <FleetPicker
          mode="multi"
          aria-label="Fleet scope"
          fleets={fleets}
          value={fleetIds}
          onChange={(ids) => {
            setFleetIds(ids);
            setFleetError(null);
          }}
        />
        {fleetError && <p className="mt-1.5 text-xs text-danger">{fleetError}</p>}
        {isSelf && (
          <p className="mt-1.5 text-xs text-text-muted">
            Changes to your own access apply after you reload or sign in again.
          </p>
        )}
      </div>
      <div className="mb-5">
        <span className="mb-1.5 block text-xs font-bold text-text-muted">Status</span>
        <Segmented<User['status']>
          label="Status"
          value={status}
          onChange={setStatus}
          disabled={isSelf}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        {isSelf && <LockedNote>{OWN_STATUS_REASON}</LockedNote>}
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disable ${user.name}?`}
        description="They will be signed out now."
        confirmLabel="Disable"
        pending={saving}
        onConfirm={() => void save()}
      />
    </form>
  );
}
