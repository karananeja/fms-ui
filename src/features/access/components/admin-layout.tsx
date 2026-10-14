import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface AdminLayoutProps {
  /** Page heading (the `h1`). */
  title: string;
  /** One line under the heading. */
  description?: ReactNode;
  /** Buttons on the right of the header (wrap under the title on mobile). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * F03 §4: every admin page. A header (title, optional description and actions) over a
 * content column on `--bg`, max 1200 px, 24 px padding (16 px on mobile).
 */
export function AdminLayout({
  title,
  description,
  actions,
  className,
  children,
}: AdminLayoutProps) {
  return (
    <div className="min-h-full bg-bg">
      <div
        className={cn('mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-4 sm:p-6', className)}
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-[0.04em]">{title}</h1>
            {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Body of an admin page that isn't built yet (replaced by F03a / F03b). */
export function AdminPlaceholder({ children = 'Coming soon' }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-60 items-center justify-center rounded-tile border border-tile-border bg-tile p-6 text-sm text-text-muted">
      {children}
    </div>
  );
}
