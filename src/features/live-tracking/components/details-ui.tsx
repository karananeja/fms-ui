import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

/** Uppercase, letter-spaced muted label (reference typography). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[11px] font-semibold tracking-[0.14em] text-text-muted uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className, label }: { className?: string; label: string }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className={cn('animate-pulse rounded-[var(--radius-card)] bg-surface-2', className)}
    />
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
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className="text-text-muted hover:text-text"
      onClick={() => void copy()}
    >
      <Copy />
    </Button>
  );
}
