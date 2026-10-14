import { useEffect } from 'react';
import { cn } from '@/shared/lib/utils';
import { useRequestDesk } from '../use-request-desk';

/**
 * F14-R1: the open-request count on the "Requests" nav item, live from the desk store (which it
 * keeps loaded while the shell is shown). Hidden at zero.
 */
export function RequestsNavBadge({ variant }: { variant: 'rail' | 'drawer' }) {
  const { store, state } = useRequestDesk((s) => s.openCount);
  useEffect(() => store.retain(), [store]);
  const count = state;
  if (!count) return null;
  return (
    <span
      data-testid={`requests-badge-${variant}`}
      className={cn(
        'min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] leading-[18px] font-black text-white tabular-nums',
        variant === 'rail' ? 'absolute -top-1 -right-1' : 'ml-auto',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
