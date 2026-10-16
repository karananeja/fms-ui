import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Gauge, KeyRound, LogOut } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { Me } from '@shared/contract/index.ts';
import { ROUTE_PERMISSIONS, useCan } from '@/features/access/permissions/can';
import { cn } from '@/shared/lib/utils';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { initials } from '../lib/initials.ts';
import { selectMe, useSession, useSessionStore } from '../session/use-session.ts';

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[34px] shrink-0 place-items-center rounded-full border border-glass-border bg-linear-135 from-tile-border to-surface-solid text-xs font-semibold text-text-muted',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function Identity({ me }: { me: Me }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-text">{me.user.name}</p>
      <p className="truncate text-xs text-text-muted">{me.user.email}</p>
      <p className="mt-1 text-[11px] font-bold tracking-[0.06em] text-accent uppercase">
        {me.role.name}
      </p>
    </div>
  );
}

function SignOutButton({ className }: { className?: string }) {
  const session = useSessionStore();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // The app layout navigates to /login once the session is anonymous (F02-R11).
        void session.logout();
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-tile px-3 py-2.5 text-sm text-text-muted outline-none hover:bg-tile hover:text-danger focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
    >
      <LogOut className="size-4" aria-hidden />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

/** F25: the user's own AI keys; hidden without the assistant. */
function AiSettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  const allowed = useCan(ROUTE_PERMISSIONS['/settings/ai']);
  if (!allowed) return null;
  return (
    <Link
      to="/settings/ai"
      onClick={onNavigate}
      className="flex w-full items-center gap-2 rounded-tile px-3 py-2.5 text-sm text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
    >
      <KeyRound className="size-4" aria-hidden />
      AI assistant settings
    </Link>
  );
}

/** F30: the user's AI token usage; hidden without the assistant. */
function AiUsageLink({ onNavigate }: { onNavigate?: () => void }) {
  const allowed = useCan(ROUTE_PERMISSIONS['/settings/usage']);
  if (!allowed) return null;
  return (
    <Link
      to="/settings/usage"
      onClick={onNavigate}
      className="flex w-full items-center gap-2 rounded-tile px-3 py-2.5 text-sm text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Gauge className="size-4" aria-hidden />
      AI usage
    </Link>
  );
}

/**
 * F02-R11: the signed-in user (initials, name, email, role) and "Sign out" — a popover from the
 * rail's avatar on desktop, an inline block at the bottom of the mobile drawer.
 */
export function UserMenu({ variant }: { variant: 'rail' | 'drawer' }) {
  const me = useSession(selectMe);
  if (!me) return null;

  if (variant === 'drawer') {
    return (
      <section aria-label="Account" className="border-t border-glass-border px-2 pt-3">
        <div className="flex items-center gap-3 px-3 pb-2">
          <Avatar name={me.user.name} />
          <Identity me={me} />
        </div>
        <div className="px-3 pb-2">
          <ThemeToggle variant="menu" />
        </div>
        <AiSettingsLink />
        <AiUsageLink />
        <SignOutButton />
      </section>
    );
  }

  return <RailMenu me={me} />;
}

function RailMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Account: ${me.user.name}`}
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-accent"
      >
        <Avatar name={me.user.name} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="end"
          sideOffset={12}
          aria-label="Account"
          className="z-50 w-64 rounded-tile border border-glass-border bg-surface-solid p-2 text-text shadow-[0_16px_40px_var(--shadow)]"
        >
          <div className="flex items-center gap-3 px-2 pt-1 pb-3">
            <Avatar name={me.user.name} />
            <Identity me={me} />
          </div>
          <div className="border-t border-glass-border px-2 py-2">
            <ThemeToggle variant="menu" />
          </div>
          <div className="border-t border-glass-border pt-1">
            <AiSettingsLink onNavigate={() => setOpen(false)} />
            <AiUsageLink onNavigate={() => setOpen(false)} />
            <SignOutButton />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
