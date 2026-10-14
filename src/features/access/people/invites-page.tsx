import { AdminLayout, AdminPlaceholder } from '../components/admin-layout';

/** `/admin/invites` (F03b). Placeholder from the F03 contract commit. */
export function InvitesPage() {
  return (
    <AdminLayout title="Invites" description="Invitations sent to new users.">
      <AdminPlaceholder />
    </AdminLayout>
  );
}
