import { AdminLayout, AdminPlaceholder } from '../components/admin-layout';

/** `/admin/fleets` (F03a). Placeholder from the F03 contract commit. */
export function FleetsPage() {
  return (
    <AdminLayout title="Fleets" description="Your fleet tree and the vehicles in each fleet.">
      <AdminPlaceholder />
    </AdminLayout>
  );
}
