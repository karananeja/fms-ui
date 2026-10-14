import { AdminLayout, AdminPlaceholder } from '../components/admin-layout';

/** `/admin/users` (F03b). Placeholder from the F03 contract commit. */
export function UsersPage() {
  return (
    <AdminLayout title="Users" description="People who can sign in, their role and fleet scope.">
      <AdminPlaceholder />
    </AdminLayout>
  );
}
