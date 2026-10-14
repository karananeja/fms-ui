import { useParams } from '@tanstack/react-router';
import { PublicSharePage } from './public-share-page';

/**
 * Router adapter for `/share/$token` (lazy chunk, see `router.tsx`), used when the app navigates
 * there in-page. A fresh load of `/share/:token` boots `share-entry.tsx` instead (no router).
 */
export function PublicShareRoute() {
  const { token } = useParams({ strict: false }) as { token?: string };
  return <PublicSharePage token={token ?? ''} />;
}
