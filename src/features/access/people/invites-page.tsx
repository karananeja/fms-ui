import {
  createInviteSchema,
  type Fleet,
  type Invite,
  type Role,
  type User,
} from '@shared/contract/index.ts';
import { MailPlus, RotateCw, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { serverFieldErrors } from '@/features/auth/components/form-utils';
import { TextField } from '@/features/auth/components/text-field';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/shared/api/api-client';
import { useNow } from '@/shared/hooks/use-now';
import { Button } from '@/shared/ui/button';
import {
  createInvite,
  listFleets,
  listInvites,
  listRoles,
  listUsers,
  resendInvite,
  revokeInvite,
} from '../api/access-api';
import { AdminLayout } from '../components/admin-layout';
import {
  AdminStatusPill,
  ConfirmDialog,
  DataTable,
  LoadError,
  Modal,
  Segmented,
  SelectField,
  type Column,
} from '../components/admin-ui';
import { FleetPicker } from '../fleets/fleet-picker';
import {
  byId,
  errorText,
  fleetScopeLabel,
  formatIstShort,
  formatRelativeTime,
  roleName,
} from '../lib/access-format';
import { useResource } from '../lib/use-resource';
import { useCan } from '../permissions/can';

type StatusFilter = 'all' | Invite['status'];
const FILTERS: readonly StatusFilter[] = ['pending', 'accepted', 'revoked', 'expired', 'all'];
const FILTER_LABEL: Record<StatusFilter, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
  all: 'All',
};

function When({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} className="block whitespace-nowrap">
      {formatRelativeTime(at, now)}
      <span className="block text-[11px] text-text-faint">{formatIstShort(at)}</span>
    </time>
  );
}

/** `/admin/invites` (F03-R9): invites by status, invite dialog, resend / revoke. */
export function InvitesPage() {
  const me = useSession(selectMe);
  const canListRoles = useCan('roles.manage');
  const canListUsers = useCan('users.manage');
  const canInvite = useCan('users.invite');
  const res = useResource(async (signal) => {
    const [invites, fleets, roles, users] = await Promise.all([
      listInvites({ signal }),
      listFleets({ signal }),
      canListRoles ? listRoles({ signal }) : Promise.resolve<Role[]>([]),
      canListUsers ? listUsers({ signal }) : Promise.resolve<User[]>([]),
    ]);
    return { invites, fleets, roles, users };
  }, `${canListRoles}/${canListUsers}`);
  const now = useNow(60_000);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const invites = useMemo(
    () => [...(res.data?.invites ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [res.data],
  );
  const fleetsById = useMemo(() => byId(res.data?.fleets), [res.data]);
  const rolesById = useMemo(() => byId(res.data?.roles), [res.data]);
  const usersById = useMemo(() => byId(res.data?.users), [res.data]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: invites.length,
      pending: 0,
      accepted: 0,
      revoked: 0,
      expired: 0,
    };
    for (const i of invites) c[i.status]++;
    return c;
  }, [invites]);
  const rows = filter === 'all' ? invites : invites.filter((i) => i.status === filter);

  const replace = (next: Invite) =>
    res.setData((d) => d && { ...d, invites: d.invites.map((i) => (i.id === next.id ? next : i)) });
  const invitedBy = (id: string) => (id === me?.user.id ? 'You' : (usersById.get(id)?.name ?? id));

  const resend = async (invite: Invite) => {
    setBusyId(invite.id);
    try {
      replace(await resendInvite(invite.id));
      toast.success(`Invite resent to ${invite.email}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusyId(null);
    }
  };
  const revoke = async () => {
    const invite = revoking;
    if (!invite) return;
    setBusyId(invite.id);
    try {
      await revokeInvite(invite.id);
      replace({ ...invite, status: 'revoked' });
      toast.success(`Invite for ${invite.email} revoked`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusyId(null);
      setRevoking(null);
    }
  };

  const columns: Column<Invite>[] = [
    {
      id: 'email',
      header: 'Email',
      cell: (i) => <span className="font-extrabold">{i.email}</span>,
    },
    { id: 'role', header: 'Role', cell: (i) => roleName(i.roleId, rolesById) },
    {
      id: 'fleets',
      header: 'Fleets',
      className: 'hidden md:table-cell',
      cell: (i) => (
        <span className="text-text-muted">{fleetScopeLabel(i.fleetIds, fleetsById)}</span>
      ),
    },
    {
      id: 'by',
      header: 'Invited by',
      className: 'hidden lg:table-cell',
      cell: (i) => <span className="text-text-muted">{invitedBy(i.invitedBy)}</span>,
    },
    {
      id: 'sent',
      header: 'Sent',
      className: 'hidden sm:table-cell',
      cell: (i) => <When at={i.createdAt} now={now} />,
    },
    {
      id: 'expires',
      header: 'Expires',
      className: 'hidden sm:table-cell',
      cell: (i) => <When at={i.expiresAt} now={now} />,
    },
    { id: 'status', header: 'Status', cell: (i) => <AdminStatusPill status={i.status} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-0 text-right',
      cell: (i) => (
        <div className="flex justify-end gap-1">
          {(i.status === 'pending' || i.status === 'expired') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busyId === i.id}
              aria-label={`Resend invite to ${i.email}`}
              onClick={() => void resend(i)}
            >
              <RotateCw /> <span className="hidden sm:inline">Resend</span>
            </Button>
          )}
          {i.status === 'pending' && (
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-danger"
              disabled={busyId === i.id}
              aria-label={`Revoke invite to ${i.email}`}
              onClick={() => setRevoking(i)}
            >
              <Undo2 /> <span className="hidden sm:inline">Revoke</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AdminLayout
      title="Invites"
      description="Invitations sent to new users. Times are IST."
      actions={
        canInvite && (
          <Button onClick={() => setInviting(true)}>
            <MailPlus /> Invite user
          </Button>
        )
      }
    >
      <Segmented<StatusFilter>
        label="Filter by status"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
      />
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      <DataTable
        label="Invites"
        columns={columns}
        rows={rows}
        rowKey={(i) => i.id}
        loading={res.loading}
        empty={`No ${filter === 'all' ? '' : `${FILTER_LABEL[filter].toLowerCase()} `}invites.`}
      />
      <Modal
        open={inviting}
        onOpenChange={setInviting}
        title="Invite user"
        description="They get an email link to set their name and password."
      >
        {inviting && (
          <InviteForm
            roles={res.data?.roles ?? []}
            fleets={res.data?.fleets ?? []}
            onCancel={() => setInviting(false)}
            onCreated={(invite) => {
              res.setData((d) => d && { ...d, invites: [invite, ...d.invites] });
              setFilter('pending');
              setInviting(false);
              toast.success(`Invite sent to ${invite.email}`);
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this invite?"
        description={`The link sent to ${revoking?.email ?? ''} stops working.`}
        confirmLabel="Revoke"
        pending={busyId !== null}
        onConfirm={() => void revoke()}
      />
    </AdminLayout>
  );
}

type Field = 'email' | 'roleId' | 'fleetIds';

/** F03-R9 invite dialog body: email, role, fleet scope (≥ 1); 409s show on the email field. */
function InviteForm({
  roles,
  fleets,
  onCancel,
  onCreated,
}: {
  roles: readonly Role[];
  fleets: readonly Fleet[];
  onCancel: () => void;
  onCreated: (invite: Invite) => void;
}) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [fleetIds, setFleetIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    if (!createInviteSchema.shape.email.safeParse(email.trim()).success)
      next.email = 'Enter a valid email address.';
    if (!roleId) next.roleId = 'Choose a role.';
    if (fleetIds.length === 0) next.fleetIds = 'Choose at least one fleet.';
    return next;
  };

  const submit = async () => {
    const next = validate();
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) {
      if (next.email) emailRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      onCreated(await createInvite({ email: email.trim(), roleId, fleetIds }));
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ email: err.message });
        emailRef.current?.focus();
        return;
      }
      const fields = serverFieldErrors(err);
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(errorText(err));
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        ref={emailRef}
        id="invite-email"
        label="Email"
        type="email"
        autoComplete="off"
        value={email}
        error={errors.email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
        }}
      />
      <SelectField
        id="invite-role"
        label="Role"
        value={roleId}
        onChange={(v) => {
          setRoleId(v);
          setErrors((x) => ({ ...x, roleId: undefined }));
        }}
        error={errors.roleId}
        options={[
          { value: '', label: 'Choose a role' },
          ...roles.map((r) => ({ value: r.id, label: r.name })),
        ]}
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
            setErrors((x) => ({ ...x, fleetIds: undefined }));
          }}
        />
        {errors.fleetIds && <p className="mt-1.5 text-xs text-danger">{errors.fleetIds}</p>}
      </div>
      {formError && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>
    </form>
  );
}
