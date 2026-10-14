import { cn } from '@/shared/lib/utils';

/** The "F" mark of the rail, drawer and auth screens. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-label="FMS"
      role="img"
      className={cn(
        'grid size-[38px] shrink-0 place-items-center rounded-tile bg-linear-135 from-accent to-accent-2 text-[15px] font-black text-accent-ink shadow-[0_0_24px_var(--accent-glow)]',
        className,
      )}
    >
      F
    </span>
  );
}
