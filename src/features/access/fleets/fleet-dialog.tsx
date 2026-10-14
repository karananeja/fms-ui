import { XIcon } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/shared/ui/button';

export interface FleetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Primary button text. */
  submitLabel: string;
  submitDisabled?: boolean;
  destructive?: boolean;
  onSubmit: () => void;
  children?: ReactNode;
}

/**
 * F03 §4: dialogs reuse the F07 card style: a 420 px `surface-solid` card, centred on desktop and
 * a bottom sheet on mobile.
 */
export function FleetDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  submitDisabled,
  destructive,
  onSubmit,
  children,
}: FleetDialogProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!submitDisabled) onSubmit();
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-[var(--radius-panel)] border border-glass-border bg-surface-solid text-text shadow-[0_30px_80px_rgb(0_0_0/0.55)] outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-panel)]">
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-extrabold tracking-[0.04em]">
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-1 text-sm text-text-muted">
                    {description}
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-[10px] text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-4" aria-hidden />
              </Dialog.Close>
            </header>
            {children && <div className="min-h-0 overflow-y-auto px-5 pb-2">{children}</div>}
            <footer className="flex justify-end gap-2 px-5 pt-3 pb-5">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant={destructive ? 'destructive' : 'default'}
                disabled={submitDisabled}
              >
                {submitLabel}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
