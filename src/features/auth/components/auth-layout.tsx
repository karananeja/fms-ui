import type { ReactNode } from 'react';
import { CircleAlert, type LucideIcon } from 'lucide-react';
import { BrandMark } from '@/shared/ui/brand-mark';
import { cn } from '@/shared/lib/utils';
import { AuthBackdrop } from './auth-backdrop';

/** Shared backdrop + glass card for every auth screen (spec §4). */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-auto street-grid px-4 py-10">
      <AuthBackdrop />
      <div aria-hidden className="vignette pointer-events-none fixed inset-0" />
      <main
        aria-labelledby="auth-title"
        className="auth-card relative w-full max-w-[400px] rounded-panel p-6 shadow-[0_24px_60px_var(--shadow)] glass sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="fms-pulse" />
          <h1
            id="auth-title"
            className="font-display text-xs font-extrabold tracking-[0.12em] text-text-muted uppercase"
          >
            {title}
          </h1>
        </div>
        {children}
      </main>
    </div>
  );
}

/** Form-level message: `alert` for errors (announced at once), `status` for notices. */
export function FormMessage({
  tone,
  children,
  id,
}: {
  tone: 'error' | 'info';
  children: ReactNode;
  id?: string;
}) {
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mb-4 rounded-tile border px-3 py-2.5 text-[13px] leading-snug',
        tone === 'error'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-accent/30 bg-accent-soft text-text',
      )}
    >
      {children}
    </p>
  );
}

/** Error / expired-link state: an icon, one sentence and one action (spec §4). */
export function StateMessage({
  icon: Icon = CircleAlert,
  children,
  action,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-tile text-warn">
        <Icon className="size-6" aria-hidden />
      </span>
      <p role="alert" className="text-sm leading-relaxed text-text">
        {children}
      </p>
      {action}
    </div>
  );
}

export const linkClass =
  'rounded-sm text-[13px] text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';
