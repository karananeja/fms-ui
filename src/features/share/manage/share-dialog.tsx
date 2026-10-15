import type { ShareLink } from '@shared/contract/index.ts';
import { XIcon } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { LoadError } from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import { listShareLinks } from '../api/share-api';
import { newestFirst, shareLinkStatus } from '../lib/share-link-model';
import { ShareForm } from './share-form';
import { ShareLinkList } from './share-link-list';
import { useCreatorName, useRevokeFlow } from './use-share-links';

type TabId = 'create' | 'links';

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  /** Shown in the title. */
  regno: string;
}

/**
 * F10-R1: the Share dialog for one vehicle. Desktop: a centred 480 px card in the F07 style;
 * below 640 px: a bottom sheet. Tabs: Create · Links (n), n = active links for this vehicle.
 */
export function ShareDialog({ open, onOpenChange, vehicleId, regno }: ShareDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          data-share-dialog
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[var(--radius-panel)] border border-glass-border bg-surface-solid text-text shadow-float outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-panel)]"
        >
          <div
            aria-hidden
            className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-border sm:hidden"
          />
          <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-1 sm:pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold tracking-[0.04em]">
                Share live location
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 truncate text-xs text-text-muted">
                {regno} · a public link, no sign-in needed
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-[10px] text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          {open && <ShareDialogBody vehicleId={vehicleId} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShareDialogBody({ vehicleId }: { vehicleId: string }) {
  const me = useSession(selectMe);
  const canRevokeAny = useCan('share.revoke');
  const creatorName = useCreatorName(me?.user.id);
  const now = useNow(30_000);
  const [tab, setTab] = useState<TabId>('create');
  const res = useResource((signal) => listShareLinks({ vehicleId }, { signal }), vehicleId);
  const links = useMemo(() => [...(res.data ?? [])].sort(newestFirst), [res.data]);
  const activeCount = links.filter((l) => shareLinkStatus(l, now) === 'active').length;

  const upsert = (link: ShareLink) =>
    res.setData((d) => [link, ...(d ?? []).filter((l) => l.id !== link.id)]);
  const revoke = useRevokeFlow(upsert);

  const tabs: { id: TabId; label: string; n?: number }[] = [
    { id: 'create', label: 'Create' },
    { id: 'links', label: 'Links', n: res.data ? activeCount : undefined },
  ];

  return (
    <>
      <div
        role="tablist"
        aria-label="Share sections"
        className="mx-5 mt-3 flex gap-0.5 rounded-xl border border-tile-border bg-tile p-[3px]"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`share-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="share-tabpanel"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-[9px] py-[7px] text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.id ? 'bg-tile-border text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {t.label}
            {t.n !== undefined && (
              <span className="ml-1 text-accent" data-testid="share-active-count">
                {t.n}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        id="share-tabpanel"
        role="tabpanel"
        aria-labelledby={`share-tab-${tab}`}
        className="min-h-0 overflow-y-auto px-5 pt-4 pb-5"
      >
        {tab === 'create' ? (
          <ShareForm vehicleId={vehicleId} onCreated={upsert} />
        ) : res.error ? (
          <LoadError message={errorText(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <p className="p-4 text-center text-sm text-text-muted">Loading…</p>
        ) : (
          <ShareLinkList
            links={links}
            now={now}
            meId={me?.user.id}
            canRevokeAny={canRevokeAny}
            creatorName={creatorName}
            onRevoke={revoke.request}
          />
        )}
      </div>
      {revoke.dialog}
    </>
  );
}
