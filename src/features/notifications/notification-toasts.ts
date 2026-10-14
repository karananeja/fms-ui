import type { Notification } from '@shared/contract/index.ts';
import { toast } from 'sonner';

/** The part of sonner's `toast` the policy uses (injected so tests can fake it). */
export interface ToastApi {
  show(n: Notification, opts: { onOpen(): void; onClose(): void }): void;
  showMore(count: number, opts: { onOpen(): void; onClose(): void }): void;
  dismiss(id: string): void;
}

export const MAX_TOASTS = 3;
export const MORE_TOAST_ID = 'notifications-more';

/** D-098: only warning and critical notifications toast. */
export const toastWorthy = (n: Notification) =>
  n.severity === 'warning' || n.severity === 'critical';

/**
 * F15-R4 / D-098: toasts for live warning/critical arrivals only (never for items loaded over
 * REST). At most `MAX_TOASTS` are visible: once they are full, the oldest item toast makes way
 * for one "+N more" toast that counts every further arrival until it closes.
 */
export class NotificationToasts {
  /** Visible item toasts, oldest first. */
  private readonly visible: string[] = [];
  private more = 0;

  constructor(
    private readonly api: ToastApi,
    private readonly open: (n: Notification | null) => void,
  ) {}

  push(arrivals: readonly Notification[]): void {
    let moreChanged = false;
    for (const n of arrivals) {
      if (!toastWorthy(n)) continue;
      if (this.more === 0 && this.visible.length < MAX_TOASTS) {
        this.visible.push(n.id);
        this.api.show(n, { onOpen: () => this.open(n), onClose: () => this.closed(n.id) });
        continue;
      }
      if (this.more === 0) {
        const oldest = this.visible.shift()!;
        this.api.dismiss(oldest);
      }
      this.more++;
      moreChanged = true;
    }
    if (moreChanged)
      this.api.showMore(this.more, {
        onOpen: () => this.open(null),
        onClose: () => {
          this.more = 0;
        },
      });
  }

  /** Visible toasts right now (item toasts + the "+N more" toast). */
  get count(): number {
    return this.visible.length + (this.more > 0 ? 1 : 0);
  }

  get moreCount(): number {
    return this.more;
  }

  private closed(id: string): void {
    const i = this.visible.indexOf(id);
    if (i >= 0) this.visible.splice(i, 1);
  }
}

/** sonner, as the toast policy sees it (D-098). */
export const sonnerToasts: ToastApi = {
  show: (n, { onOpen, onClose }) => {
    const show = n.severity === 'critical' ? toast.error : toast.warning;
    show(n.title, {
      id: n.id,
      description: n.body,
      duration: n.severity === 'critical' ? 10_000 : 6_000,
      action: { label: 'Open', onClick: onOpen },
      onDismiss: onClose,
      onAutoClose: onClose,
    });
  },
  showMore: (count, { onOpen, onClose }) => {
    toast(`+${count} more notifications`, {
      id: MORE_TOAST_ID,
      duration: 8_000,
      action: { label: 'View', onClick: onOpen },
      onDismiss: onClose,
      onAutoClose: onClose,
    });
  },
  dismiss: (id) => toast.dismiss(id),
};

