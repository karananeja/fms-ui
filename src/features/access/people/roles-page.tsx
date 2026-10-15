import {
  PERMISSION_LABELS,
  PERMISSIONS,
  type Permission,
  type Role,
  type User,
} from '@shared/contract/index.ts';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { serverFieldErrors } from '@/features/auth/components/form-utils';
import { TextField } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { createRole, deleteRole, listRoles, listUsers, updateRole } from '../api/access-api';
import { AdminLayout } from '../components/admin-layout';
import {
  ConfirmDialog,
  DataTable,
  LoadError,
  LockedNote,
  SidePanel,
  type Column,
} from '../components/admin-ui';
import { errorText } from '../lib/access-format';
import { useResource } from '../lib/use-resource';
import { useCan } from '../permissions/can';
import { isSystemOnly, PERMISSION_GROUPS, SYSTEM_ONLY_REASON } from './permission-groups';

/** `null` = closed, `'new'` = create, otherwise the role id being edited. */
type Editing = null | 'new' | string;

/** `/admin/roles` (F03-R10): roles with permission and user counts, role editor. */
export function RolesPage() {
  const canListUsers = useCan('users.manage');
  const res = useResource(async (signal) => {
    const [roles, users] = await Promise.all([
      listRoles({ signal }),
      canListUsers ? listUsers({ signal }) : Promise.resolve<User[]>([]),
    ]);
    return { roles, users };
  }, String(canListUsers));
  const [editing, setEditing] = useState<Editing>(null);
  const roles = useMemo(
    () =>
      [...(res.data?.roles ?? [])].sort(
        (a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name),
      ),
    [res.data],
  );
  const userCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of res.data?.users ?? []) m.set(u.roleId, (m.get(u.roleId) ?? 0) + 1);
    return m;
  }, [res.data]);
  const role = editing && editing !== 'new' ? roles.find((r) => r.id === editing) : undefined;

  const columns: Column<Role>[] = [
    {
      id: 'name',
      header: 'Role',
      cell: (r) => (
        <span className="font-semibold">
          {r.name}
          {r.system && (
            <span className="ml-2 rounded-full bg-tile px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
              System
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'permissions',
      header: 'Permissions',
      cell: (r) => (
        <span className="tabular-nums">
          {r.permissions.length}
          <span className="text-text-faint"> / {PERMISSIONS.length}</span>
        </span>
      ),
    },
    {
      id: 'users',
      header: 'Users',
      cell: (r) => (
        <span className="tabular-nums">{canListUsers ? (userCounts.get(r.id) ?? 0) : '—'}</span>
      ),
    },
  ];

  const closeEditor = () => setEditing(null);
  return (
    <AdminLayout
      title="Roles"
      description="Roles and the permissions they grant."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus /> New role
        </Button>
      }
    >
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      <DataTable
        label="Roles"
        columns={columns}
        rows={roles}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(r.id)}
        selectedKey={editing}
        loading={res.loading}
        empty="No roles yet."
      />
      <SidePanel
        open={editing === 'new' || role !== undefined}
        onOpenChange={(open) => !open && closeEditor()}
        title={editing === 'new' ? 'New role' : (role?.name ?? '')}
        description={role?.system ? 'System role · read-only' : 'Custom role'}
      >
        {(editing === 'new' || role) && (
          <RoleEditor
            key={editing}
            role={role ?? null}
            onClose={closeEditor}
            onSaved={(saved) => {
              res.setData(
                (d) =>
                  d && {
                    ...d,
                    roles: d.roles.some((r) => r.id === saved.id)
                      ? d.roles.map((r) => (r.id === saved.id ? saved : r))
                      : [...d.roles, saved],
                  },
              );
              toast.success(`Saved ${saved.name}`);
              closeEditor();
            }}
            onDeleted={(id) => {
              res.setData((d) => d && { ...d, roles: d.roles.filter((r) => r.id !== id) });
              toast.success('Role deleted');
              closeEditor();
            }}
          />
        )}
      </SidePanel>
    </AdminLayout>
  );
}

/**
 * F03-R10 editor: name + grouped permission checkboxes. System roles are read-only;
 * `users.invite` / `roles.manage` are locked for custom roles (B8, R14); delete shows the
 * server's 409 when the role is in use.
 */
function RoleEditor({
  role,
  onClose,
  onSaved,
  onDeleted,
}: {
  role: Role | null;
  onClose: () => void;
  onSaved: (role: Role) => void;
  onDeleted: (id: string) => void;
}) {
  const readOnly = role?.system ?? false;
  const [name, setName] = useState(role?.name ?? '');
  const [granted, setGranted] = useState<ReadonlySet<Permission>>(
    () => new Set(role?.permissions ?? []),
  );
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (p: Permission, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const save = async () => {
    if (!name.trim()) {
      setErrors({ name: 'Enter a role name.' });
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    const permissions = PERMISSIONS.filter((p) => granted.has(p));
    try {
      onSaved(
        role
          ? await updateRole(role.id, { name: name.trim(), permissions })
          : await createRole({ name: name.trim(), permissions }),
      );
    } catch (err) {
      setPending(false);
      const fields = serverFieldErrors(err);
      if (fields.name || fields.permissions)
        setErrors({ name: fields.name, permissions: fields.permissions });
      else setFormError(errorText(err));
    }
  };

  const remove = async () => {
    if (!role) return;
    setPending(true);
    setFormError(null);
    try {
      await deleteRole(role.id);
      onDeleted(role.id);
    } catch (err) {
      setPending(false);
      setConfirmDelete(false);
      setFormError(errorText(err));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) void save();
      }}
    >
      {readOnly && (
        <div className="mb-4">
          <LockedNote>System roles are read-only.</LockedNote>
        </div>
      )}
      <TextField
        id="role-name"
        label="Name"
        value={name}
        readOnly={readOnly}
        error={errors.name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-col gap-3">
        {PERMISSION_GROUPS.map((group) => {
          const locked = !readOnly && group.permissions.some(isSystemOnly);
          return (
            <fieldset
              key={group.label}
              className="rounded-tile border border-tile-border bg-tile px-3 pt-1 pb-3"
            >
              <legend className="px-1 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                {group.label}
              </legend>
              <div className="flex flex-col gap-2">
                {group.permissions.map((p) => {
                  const disabled = readOnly || isSystemOnly(p);
                  return (
                    <label
                      key={p}
                      className={cn(
                        'flex items-center gap-2.5 text-sm',
                        disabled ? 'text-text-muted' : 'cursor-pointer',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={granted.has(p)}
                        disabled={disabled}
                        onChange={(e) => toggle(p, e.target.checked)}
                      />
                      {PERMISSION_LABELS[p]}
                    </label>
                  );
                })}
              </div>
              {locked && <LockedNote>{SYSTEM_ONLY_REASON}</LockedNote>}
            </fieldset>
          );
        })}
      </div>
      {errors.permissions && <p className="mt-2 text-xs text-danger">{errors.permissions}</p>}
      {formError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2">
        {role && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            className="text-danger hover:text-danger"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : role ? 'Save changes' : 'Create role'}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${role?.name ?? 'role'}?`}
        description="This can't be undone."
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => void remove()}
      />
    </form>
  );
}
