import type { ShareLink } from '@shared/contract/index.ts';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listUsers } from '@/features/access/api/access-api';
import { ConfirmDialog } from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { revokeShareLink } from '../api/share-api';

/** The public URL of a link (`location.origin` + `/share/<token>`). */
export const fullShareUrl = (link: Pick<ShareLink, 'url'>) =>
  `${window.location.origin}${link.url}`;

/** Copies `text`; confirms with a toast. Resolves `true` on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied');
    return true;
  } catch {
    toast.error('Could not copy the link');
    return false;
  }
}

/**
 * "You", the user's name (readable with `users.manage`), or their ID. Links carry only
 * `createdBy`; without `users.manage` there is no list of names to read.
 */
export function useCreatorName(meId: string | undefined): (userId: string) => string {
  const canListUsers = useCan('users.manage');
  const users = useResource(
    (signal) => (canListUsers ? listUsers({ signal }) : Promise.resolve([])),
    String(canListUsers),
  );
  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.name])), [users.data]);
  return (userId) => (userId === meId ? 'You' : (names.get(userId) ?? userId));
}

/**
 * Revoke with confirmation (F10-R6): `request(link)` opens the confirm; on success the link
 * comes back to `onRevoked` with `revokedAt` set locally.
 */
export function useRevokeFlow(onRevoked: (link: ShareLink) => void) {
  const [target, setTarget] = useState<ShareLink | null>(null);
  const [pending, setPending] = useState(false);
  const confirm = async () => {
    const link = target;
    if (!link) return;
    setPending(true);
    try {
      await revokeShareLink(link.id);
      onRevoked({ ...link, revokedAt: Date.now() });
      toast.success('Link revoked');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPending(false);
      setTarget(null);
    }
  };
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Revoke this link?"
      description="Anyone with this link loses access now."
      confirmLabel="Revoke"
      pending={pending}
      onConfirm={() => void confirm()}
    />
  );
  return { request: setTarget, pending, dialog };
}
