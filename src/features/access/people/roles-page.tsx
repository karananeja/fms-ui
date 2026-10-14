import { AdminLayout, AdminPlaceholder } from '../components/admin-layout';

/** `/admin/roles` (F03b). Placeholder from the F03 contract commit. */
export function RolesPage() {
  return (
    <AdminLayout title="Roles" description="Roles and the permissions they grant.">
      <AdminPlaceholder />
    </AdminLayout>
  );
}
