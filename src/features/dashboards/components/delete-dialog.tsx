import { useState } from 'react';
import { ConfirmDialog } from '@/features/access/components/admin-ui';

/** §3 / §4.2: delete confirm (Cancel has the initial focus). */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  onConfirm(): Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete '${title}'?`}
      description="Its chat is deleted too. This can't be undone."
      confirmLabel="Delete"
      pending={pending}
      onConfirm={async () => {
        setPending(true);
        try {
          await onConfirm();
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
