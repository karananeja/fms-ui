import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';

/** Uppercase, letter-spaced muted label (mockup `.label`). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Mockup `.panel` / `.ptile`: translucent tile. */
export function Tile({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-[var(--radius-tile)] border border-tile-border bg-tile p-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Small key/value tile (`.ptile`). */
export function StatTile({
  label,
  value,
  color,
  className,
  testId,
  children,
}: {
  label: string;
  value: ReactNode;
  color?: string;
  className?: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <Tile className={cn('p-2.5', className)}>
      <div className="flex items-center gap-1 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
        {label}
        {children}
      </div>
      <div className="mt-0.5 truncate text-xl font-black" style={{ color }} data-testid={testId}>
        {value}
      </div>
    </Tile>
  );
}

export function Skeleton({ className, label }: { className?: string; label: string }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className={cn('animate-pulse rounded-[var(--radius-tile)] bg-tile', className)}
    />
  );
}

/** Mockup `.ibtn`: 32 px bordered icon button. */
export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-glass-border bg-tile text-text-muted transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-[15px]"
    >
      {children}
    </button>
  );
}

/** Copies `value` and confirms with a "Copied" toast. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <IconButton label={label} onClick={() => void copy()}>
      <Copy />
    </IconButton>
  );
}
