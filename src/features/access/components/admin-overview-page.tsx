import { AdminLayout, AdminPlaceholder } from './admin-layout';

/** `/admin` (F03b). Placeholder from the F03 contract commit. */
export function AdminOverviewPage() {
  return (
    <AdminLayout title="Admin" description="Fleets, users, invites and roles.">
      <AdminPlaceholder />
    </AdminLayout>
  );
}
