import type { ReactNode } from 'react';
import { NoAccessPage } from '../components/no-access-page';
import { useCan, type PermissionCheck } from './can';

/** F03-R1: renders `children` with the permission (any of a list), else the No access page. */
export function RequirePermission({ p, children }: { p: PermissionCheck; children: ReactNode }) {
  return useCan(p) ? children : <NoAccessPage />;
}
