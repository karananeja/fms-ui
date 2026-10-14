import { Link } from '@tanstack/react-router';
import { ShieldOff } from 'lucide-react';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { firstAllowedPath } from '../permissions/can';

const LABELS = {
  '/live-tracking': 'Go to live tracking',
  '/admin': 'Go to admin',
  '/admin/fleets': 'Go to fleets',
  '/admin/users': 'Go to users',
  '/admin/invites': 'Go to invites',
  '/admin/roles': 'Go to roles',
  '/admin/share-links': 'Go to share links',
} as const;

/** F03-R1: shown in place of a page you lack the permission for; links to one you can open. */
export function NoAccessPage() {
  const target = firstAllowedPath(useSession(selectMe));
  return (
    <section className="flex h-full min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldOff aria-hidden className="size-10 text-text-faint" />
      <h1 className="text-xl font-extrabold">You don&apos;t have access to this page.</h1>
      {target ? (
        <Link to={target} className="text-sm text-text-muted underline hover:text-text">
          {LABELS[target]}
        </Link>
      ) : (
        <p className="text-sm text-text-muted">Ask your administrator for access.</p>
      )}
    </section>
  );
}
