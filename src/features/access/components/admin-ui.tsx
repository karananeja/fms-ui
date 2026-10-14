import type { Invite, User } from '@shared/contract/index.ts';
import { ChevronDown, Lock, X } from 'lucide-react';
import { AlertDialog, Dialog } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { inputClass } from '@/features/auth/components/text-field';
import { TintPill } from '@/features/live-tracking/components/status-pill';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

type UserStatus = User['status'];
type InviteStatus = Invite['status'];

/* Shared building blocks of the F03b admin pages (spec §4): glass tables like F09, the F07
   card style for side panels (`surface-solid`, 420 px; bottom sheet on mobile) and dialogs,
   and status pills with admin variants. */

const ADMIN_STATUS: Record<UserStatus | InviteStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--ok)' },
  disabled: { label: 'Disabled', color: 'var(--text-faint)' },
  pending: { label: 'Pending', color: 'var(--warn)' },
  accepted: { label: 'Accepted', color: 'var(--accent)' },
  revoked: { label: 'Revoked', color: 'var(--danger)' },
  expired: { label: 'Expired', color: 'var(--text-muted)' },
};

/** Status pill, admin variants (active / disabled / pending / accepted / revoked / expired). */
export function AdminStatusPill({ status }: { status: UserStatus | InviteStatus }) {
  const { label, color } = ADMIN_STATUS[status];
  return (
    <TintPill color={color} data-status={status}>
      {label}
    </TintPill>
  );
}

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Applied to both the header and the cells (e.g. `hidden md:table-cell`, widths). */
  className?: string;
}

/** F09-style glass table: Doto uppercase muted headers, 40 px rows, `--accent-soft` selection. */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  loading,
  empty = 'Nothing to show.',
}: {
  label: string;
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  loading?: boolean;
  empty?: ReactNode;
}) {
  const onKey = (e: KeyboardEvent, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] shadow-[0_30px_80px_rgb(0_0_0/0.35)] glass">
      <div className="overflow-x-auto">
        <table aria-label={label} aria-busy={loading || undefined} className="w-full text-sm">
          <thead className="bg-surface-solid">
            <tr className="h-10 border-b border-glass-border">
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    'px-3 text-left text-[11px] font-black tracking-[0.12em] whitespace-nowrap text-text-muted uppercase',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const selected = key === selectedKey;
              return (
                <tr
                  key={key}
                  data-row-key={key}
                  aria-selected={onRowClick ? selected : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick && (() => onRowClick(row))}
                  onKeyDown={onRowClick && ((e) => onKey(e, row))}
                  className={cn(
                    'h-10 border-b border-glass-border/50 last:border-b-0',
                    onRowClick &&
                      'cursor-pointer outline-none hover:bg-tile focus-visible:bg-tile focus-visible:shadow-[inset_2px_0_0_var(--accent)]',
                    selected && 'bg-accent-soft hover:bg-accent-soft',
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.id} className={cn('px-3 py-1.5 align-middle', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="p-6 text-center text-sm text-text-muted">{loading ? 'Loading…' : empty}</p>
      )}
    </div>
  );
}

const DESKTOP = '(min-width: 1024px)';

/** F07 card style: a 420 px `surface-solid` panel on the right; a bottom sheet on mobile. */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          data-side-panel={desktop ? 'card' : 'sheet'}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border border-glass-border bg-surface-solid shadow-[0_30px_80px_rgb(0_0_0/0.55)] outline-none data-[state=open]:animate-in motion-reduce:animate-none',
            desktop
              ? 'top-[72px] right-3.5 bottom-3.5 w-[420px] rounded-[var(--radius-panel)]'
              : 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[var(--radius-panel)] data-[state=open]:slide-in-from-bottom',
          )}
        >
          {!desktop && (
            <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-border" />
          )}
          <div className="flex items-start gap-3 border-b border-glass-border p-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-base font-extrabold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 truncate text-xs text-text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-glass-border p-4">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Centred dialog in the F07 card style. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid shadow-[0_30px_80px_rgb(0_0_0/0.55)] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 motion-reduce:animate-none">
          <div className="flex items-start gap-3 p-5 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-extrabold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-5 pt-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmation (alertdialog) for destructive actions: disable a user, revoke an invite… */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-glass-border bg-surface-solid p-5 shadow-[0_30px_80px_rgb(0_0_0/0.55)] outline-none">
          <AlertDialog.Title className="text-base font-extrabold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const selectClass = cn(inputClass, 'h-10 appearance-none pr-9');

const Chevron = () => (
  <ChevronDown
    aria-hidden
    className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
  />
);

/** Unlabelled filter select (named by `aria-label`). */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'w-auto min-w-36')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Chevron />
    </span>
  );
}

/** Labelled native select with an optional hint (e.g. a lock reason) and error. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  hint?: ReactNode;
  error?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-text-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
          }
          onChange={(e) => onChange(e.target.value)}
          className={cn(selectClass, 'disabled:opacity-60')}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
      {hint && <LockedNote id={hintId}>{hint}</LockedNote>}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Why a control is locked (shown under it). */
export function LockedNote({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
      <Lock aria-hidden className="size-3 shrink-0" />
      {children}
    </p>
  );
}

/** Pill-shaped toggle group (filters, Active / Disabled). */
export function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; label: string; count?: number }[];
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-tile border border-tile-border bg-tile p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className="h-8 rounded-[10px] px-3 text-xs font-extrabold tracking-[0.08em] text-text-muted uppercase outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Inline error for a list that failed to load. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-tile border border-danger/40 bg-danger/10 p-3 text-sm"
    >
      {message}
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
